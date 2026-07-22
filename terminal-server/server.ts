import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { isAbsolute, relative, resolve } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "fs";
import { spawn } from "child_process";
import type { NextFunction, Request, Response } from "express";
import { isBlockedCommand } from "./security";
import { createDockerSession } from "./docker-manager";
import { handleLiTTCodeCommand } from "@litt/agent-core";
import { bearerToken, verifyTerminalToken } from "./auth";
import { prepareWorkspace, getWorkspace, getWorkspaceRoot } from "./workspace/WorkspaceManager";
import { listTree, readFile, writeFile, searchFiles } from "./workspace/FileService";
import { gitStatus } from "./workspace/GitService";

const PORT = Number(process.env.PORT || process.env.TERMINAL_SERVER_PORT || 4001);
const ALLOWED_ORIGIN = process.env.TERMINAL_ALLOWED_ORIGIN || "http://localhost:3000";
const WORKSPACE_ROOT = process.env.TERMINAL_WORKSPACE_ROOT || resolve("/tmp/littree-workspaces");
const USE_DOCKER = process.env.TERMINAL_USE_DOCKER === "true";

const MAX_READ_SIZE = 2 * 1024 * 1024;
const MAX_WRITE_SIZE = 1 * 1024 * 1024;
const MAX_PATH_LENGTH = 4096;

if (process.env.NODE_ENV === "production" && !USE_DOCKER) {
  throw new Error("TERMINAL_USE_DOCKER=true is required in production");
}

mkdirSync(WORKSPACE_ROOT, { recursive: true });

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

interface Session {
  ptyProcess: pty.IPty;
  createdAt: Date;
  userId: string;
  sessionId: string;
  cwd: string;
}

const sessions = new Map<string, Session>();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    docker: USE_DOCKER,
    authConfigured: (process.env.TERMINAL_AUTH_SECRET?.length ?? 0) >= 32,
    activeSessions: sessions.size,
    uptime: process.uptime(),
  });
});

function getUserWorkspace(userId: string) {
  const workspace = resolve(WORKSPACE_ROOT, userId);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function safePath(userId: string, filePath: string) {
  if (filePath.length > MAX_PATH_LENGTH) {
    throw new Error("Path too long");
  }
  const workspace = getUserWorkspace(userId);
  const target = resolve(workspace, filePath);
  const pathFromWorkspace = relative(workspace, target);
  if (pathFromWorkspace.startsWith("..") || isAbsolute(pathFromWorkspace)) {
    throw new Error("Invalid path");
  }
  return target;
}

type AuthenticatedRequest = Request & { terminalUserId?: string };

function requireTerminalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    req.terminalUserId = verifyTerminalToken(
      bearerToken(req.headers.authorization),
    ).sub;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.use("/files", requireTerminalAuth);

app.get("/files", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const dirPath = String(req.query.path || ".");
  try {
    const target = safePath(userId, dirPath);
    const entries = readdirSync(target, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "folder" : "file",
    }));
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
  }
});

app.post("/files/read", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    const stats = statSync(target);
    if (!stats.isFile()) {
      return res.status(400).json({ error: "Not a file" });
    }
    if (stats.size > MAX_READ_SIZE) {
      return res
        .status(413)
        .json({ error: `File exceeds maximum read size of ${MAX_READ_SIZE} bytes` });
    }
    const content = readFileSync(target, "utf-8");
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
  }
});

app.post("/files/write", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const filePath = String(req.body.path || "");
  const content = String(req.body.content || "");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_SIZE) {
    return res
      .status(413)
      .json({ error: `Content exceeds maximum write size of ${MAX_WRITE_SIZE} bytes` });
  }
  try {
    const target = safePath(userId, filePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to write file" });
  }
});

app.post("/files/delete", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const filePath = String(req.body.path || "");
  if (!filePath || filePath === ".") {
    return res.status(400).json({ error: "Refusing to delete workspace root" });
  }
  try {
    const target = safePath(userId, filePath);
    rmSync(target, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete file" });
  }
});

/* ── One-shot command runner (used by the Loop agent) ────────── */

const MAX_RUN_OUTPUT = 2 * 1024 * 1024;
const DEFAULT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

app.post("/run", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const command = String(req.body.command || "").trim();
  const cwdArg = typeof req.body.cwd === "string" ? req.body.cwd : "";
  const timeoutMs = Number.isFinite(req.body.timeoutMs)
    ? Math.min(Math.max(Number(req.body.timeoutMs), 1_000), 30 * 60 * 1000)
    : DEFAULT_RUN_TIMEOUT_MS;
  const envOverrides =
    req.body.env && typeof req.body.env === "object" && !Array.isArray(req.body.env)
      ? (req.body.env as Record<string, string>)
      : {};

  if (!command) {
    return res.status(400).json({ error: "command is required" });
  }
  if (command.length > 16_384) {
    return res.status(413).json({ error: "command too long" });
  }
  if (isBlockedCommand(command)) {
    return res.status(403).json({ error: "Blocked by security policy" });
  }

  let cwd: string;
  try {
    cwd = cwdArg ? safePath(userId, cwdArg) : getUserWorkspace(userId);
  } catch (err) {
    return res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Invalid cwd" });
  }

  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
  const shellArgs =
    process.platform === "win32"
      ? ["-NoProfile", "-Command", command]
      : ["-lc", command];

  const startedAt = Date.now();
  const child = spawn(shell, shellArgs, {
    cwd,
    env: { ...process.env, ...envOverrides, LITTREE_USER_ID: userId },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let truncated = false;
  const append = (target: "stdout" | "stderr", chunk: string) => {
    if (truncated) return;
    const combined = target === "stdout" ? stdout : stderr;
    const next = combined + chunk;
    if (next.length > MAX_RUN_OUTPUT) {
      truncated = true;
      if (target === "stdout") stdout = next.slice(0, MAX_RUN_OUTPUT);
      else stderr = next.slice(0, MAX_RUN_OUTPUT);
      return;
    }
    if (target === "stdout") stdout = next;
    else stderr = next;
  };
  child.stdout.on("data", (d) => append("stdout", d.toString("utf8")));
  child.stderr.on("data", (d) => append("stderr", d.toString("utf8")));

  const killTimer = setTimeout(() => {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 5_000);
  }, timeoutMs);

  child.on("error", (err) => {
    clearTimeout(killTimer);
    res.status(500).json({
      error: err.message,
      stdout,
      stderr,
      exitCode: null,
      truncated,
      durationMs: Date.now() - startedAt,
    });
  });

  child.on("close", (code, signal) => {
    clearTimeout(killTimer);
    res.json({
      stdout,
      stderr,
      exitCode: code,
      signal: signal ?? null,
      truncated,
      durationMs: Date.now() - startedAt,
      cwd,
    });
  });
});

/* ── Workspace Runner endpoints ─────────────────────────────── */

app.use("/v1/workspaces", requireTerminalAuth);

// POST /v1/workspaces/prepare — clone/checkout a repo into a workspace
app.post("/v1/workspaces/prepare", async (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const { projectId, installationId, owner, repo, branch, commitSha, githubToken } = req.body ?? {};
  if (!projectId || !owner || !repo || !branch) {
    return res.status(400).json({ error: "projectId, owner, repo, branch are required" });
  }
  try {
    const descriptor = await prepareWorkspace({
      userId,
      projectId,
      installationId: Number(installationId) || 0,
      owner,
      repo,
      branch,
      commitSha: commitSha ?? null,
      workspaceRoot: WORKSPACE_ROOT,
      githubToken: githubToken ?? null,
    });
    res.json({ workspace: descriptor });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Workspace preparation failed" });
  }
});

// GET /v1/workspaces/:id/tree?path=&depth=
app.get("/v1/workspaces/:id/tree", (req: AuthenticatedRequest, res) => {
  const root = getWorkspaceRoot(req.params.id, req.terminalUserId);
  if (!root) return res.status(404).json({ error: "Workspace not found" });
  try {
    const dirPath = String(req.query.path || ".");
    const depth = Number(req.query.depth) || 3;
    const tree = listTree(root, dirPath, depth);
    res.json({ tree });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list tree" });
  }
});

// GET /v1/workspaces/:id/file?path=
app.get("/v1/workspaces/:id/file", (req: AuthenticatedRequest, res) => {
  const root = getWorkspaceRoot(req.params.id, req.terminalUserId);
  if (!root) return res.status(404).json({ error: "Workspace not found" });
  try {
    const filePath = String(req.query.path || "");
    if (!filePath) return res.status(400).json({ error: "path is required" });
    const file = readFile(root, filePath);
    res.json({ file });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
  }
});

// PUT /v1/workspaces/:id/file
app.put("/v1/workspaces/:id/file", (req: AuthenticatedRequest, res) => {
  const root = getWorkspaceRoot(req.params.id, req.terminalUserId);
  if (!root) return res.status(404).json({ error: "Workspace not found" });
  try {
    const { path: filePath, content, expectedVersion } = req.body ?? {};
    if (!filePath) return res.status(400).json({ error: "path is required" });
    const file = writeFile(root, filePath, String(content ?? ""), expectedVersion);
    res.json({ file });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to write file" });
  }
});

// POST /v1/workspaces/:id/search
app.post("/v1/workspaces/:id/search", (req: AuthenticatedRequest, res) => {
  const root = getWorkspaceRoot(req.params.id, req.terminalUserId);
  if (!root) return res.status(404).json({ error: "Workspace not found" });
  try {
    const { query } = req.body ?? {};
    if (!query) return res.status(400).json({ error: "query is required" });
    const results = searchFiles(root, String(query));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
  }
});

// GET /v1/workspaces/:id/git/status
app.get("/v1/workspaces/:id/git/status", async (req: AuthenticatedRequest, res) => {
  const root = getWorkspaceRoot(req.params.id, req.terminalUserId);
  if (!root) return res.status(404).json({ error: "Workspace not found" });
  try {
    const status = await gitStatus(root);
    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Git status failed" });
  }
});

// POST /v1/workspaces/:id/runtime/start — start dev server in workspace
app.post("/v1/workspaces/:id/runtime/start", async (req: AuthenticatedRequest, res) => {
  const root = getWorkspaceRoot(req.params.id, req.terminalUserId);
  if (!root) return res.status(404).json({ error: "Workspace not found" });
  const { installCommand, devCommand } = req.body ?? {};
  if (!devCommand) return res.status(400).json({ error: "devCommand is required" });

  try {
    // Run install first (non-blocking, but wait for completion)
    if (installCommand) {
      await new Promise<void>((resolveInstall, rejectInstall) => {
        const installProc = spawn(installCommand, {
          cwd: root,
          shell: true,
          env: { ...process.env, FORCE_COLOR: "1" },
        });
        installProc.on("close", (code) => {
          if (code === 0) resolveInstall();
          else rejectInstall(new Error(`Install failed with code ${code}`));
        });
        installProc.on("error", rejectInstall);
      });
    }

    // Start dev server in background
    const devProc = spawn(devCommand, {
      cwd: root,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1", PORT: "0" },
      detached: false,
    });

    const workspaceId = req.params.id;
    const portMap = (globalThis as Record<string, unknown>).__devPorts as Map<string, number> | undefined;
    if (portMap) portMap.set(workspaceId, 0);

    // Wait for dev server to output a URL or port
    const previewUrl = await new Promise<string | null>((resolvePreview) => {
      const timeout = setTimeout(() => {
        resolvePreview(null);
      }, 30_000);

      devProc.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        const portMatch = output.match(/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{4,5})/);
        if (portMatch) {
          clearTimeout(timeout);
          const port = parseInt(portMatch[1], 10);
          if (portMap) portMap.set(workspaceId, port);
          resolvePreview(`http://localhost:${port}`);
        }
      });

      devProc.stderr?.on("data", (data: Buffer) => {
        const output = data.toString();
        const portMatch = output.match(/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{4,5})/);
        if (portMatch) {
          clearTimeout(timeout);
          const port = parseInt(portMatch[1], 10);
          if (portMap) portMap.set(workspaceId, port);
          resolvePreview(`http://localhost:${port}`);
        }
      });

      devProc.on("error", () => {
        clearTimeout(timeout);
        resolvePreview(null);
      });
    });

    res.json({ previewUrl });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Runtime start failed" });
  }
});

io.use((socket, next) => {
  try {
    socket.data.userId = verifyTerminalToken(socket.handshake.auth?.token).sub;
    const requestedWorkspaceId = socket.handshake.auth?.workspaceId;
    if (requestedWorkspaceId) {
      const workspace = getWorkspace(String(requestedWorkspaceId));
      if (!workspace || workspace.userId !== socket.data.userId) {
        return next(new Error("Workspace unavailable"));
      }
      socket.data.workspaceId = workspace.workspaceId;
    }
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.data.userId);
  const sessionId = randomUUID();

  console.log("[Terminal] Connected:", { userId, sessionId });

  const requestedWorkspaceId = socket.data.workspaceId
    ? String(socket.data.workspaceId)
    : null;
  const workspace = requestedWorkspaceId
    ? getWorkspaceRoot(requestedWorkspaceId, userId)
    : resolve(WORKSPACE_ROOT, userId);
  if (!workspace) {
    socket.emit("terminal:error", "Workspace unavailable");
    socket.disconnect();
    return;
  }
  mkdirSync(workspace, { recursive: true });

  let ptyProcess: pty.IPty;

  try {
    if (USE_DOCKER) {
      ptyProcess = createDockerSession({
        userId,
        sessionId,
        workspace,
        onData: (data: string) => socket.emit("terminal:output", data),
      });
    } else {
      const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
      ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd: workspace,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          LITTREE_USER_ID: userId,
          LITTREE_SESSION_ID: sessionId,
          HOME: workspace,
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start terminal";
    console.error("[Terminal] Start failed:", message);
    socket.emit("terminal:error", message);
    socket.disconnect();
    return;
  }

  const session: Session = {
    ptyProcess,
    createdAt: new Date(),
    userId,
    sessionId,
    cwd: workspace,
  };

  sessions.set(sessionId, session);
  socket.emit("session:ready", { sessionId });

  ptyProcess.onData((data) => {
    socket.emit("terminal:output", data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log("[Terminal] Exit:", { sessionId, exitCode, signal });
    socket.emit("terminal:output", `\r\n\x1b[31m[Session ended ${exitCode ?? signal}]\x1b[0m\r\n`);
    sessions.delete(sessionId);
  });

  socket.on("terminal:input", (data: string) => {
    if (typeof data !== "string") return;

    if (isBlockedCommand(data)) {
      socket.emit("terminal:output", "\r\n\x1b[31m⛔ Blocked unsafe command.\x1b[0m\r\n");
      return;
    }

    ptyProcess.write(data);
  });

    socket.on("litt-code:command", async (input: string) => {
    if (typeof input !== "string") return;
    socket.emit("terminal:output", "\r\n\x1b[36mLiTT-Code is thinking...\x1b[0m\r\n");
    try {
      const reply = await handleLiTTCodeCommand(input);
      socket.emit("terminal:output", "\r\n\x1b[36mLiTT-Code:\x1b[0m\r\n");
      socket.emit("terminal:output", reply.replace(/\n/g, "\r\n") + "\r\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : "LiTT-Code failed";
      socket.emit("terminal:output", `\r\n\x1b[31m⚠ ${message}\x1b[0m\r\n`);
    }
  });

  socket.on("terminal:resize", ({ cols, rows }: { cols: number; rows: number }) => {
    if (typeof cols === "number" && typeof rows === "number") {
      ptyProcess.resize(cols, rows);
    }
  });

  socket.on("disconnect", () => {
    console.log("[Terminal] Disconnected:", sessionId);
    ptyProcess.kill();
    sessions.delete(sessionId);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 LiTTree Terminal Server running on http://0.0.0.0:${PORT}`);
  console.log(`   Allowed origin: ${ALLOWED_ORIGIN}`);
  console.log(`   Workspace root: ${WORKSPACE_ROOT}`);
  console.log(`   Docker mode: ${USE_DOCKER}`);
});
