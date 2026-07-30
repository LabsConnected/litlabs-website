import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { isAbsolute, relative, resolve } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "fs";
import type { NextFunction, Request, Response } from "express";
import { isBlockedCommand } from "./security";
import { createDockerSession } from "./docker-manager";
import { handleLiTTCodeCommand } from "./litt-code";
import { bearerToken, verifyTerminalToken } from "./auth";
import {
  prepareWorkspace,
  prepareBlankWorkspace,
  getWorkspace,
  listWorkspaces,
  type WorkspaceDescriptor,
} from "./workspace/WorkspaceManager";

// ─── Service-to-service auth ───────────────────────────────────
// Internal endpoints (under /internal/*) use a shared secret via
// the X-Internal-Service-Key header. This is separate from the
// user-facing terminal JWT auth and is only for Next.js → terminal-server calls.
function requireInternalServiceAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const expectedKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
  if (expectedKey.length < 32) {
    res.status(503).json({ error: "Internal service auth not configured" });
    return;
  }
  const providedKey = req.headers["x-internal-service-key"] as string | undefined;
  if (!providedKey || providedKey.length !== expectedKey.length) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Timing-safe comparison
  const a = Buffer.from(providedKey);
  const b = Buffer.from(expectedKey);
  if (a.length !== b.length || !a.equals(b)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

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

app.get("/health/live", (_req, res) => {
  res.json({
    service: "terminal-server",
    status: "alive",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/health/ready", (_req, res) => {
  const authConfigured = (process.env.TERMINAL_AUTH_SECRET?.length ?? 0) >= 32;
  const internalServiceConfigured = (process.env.TERMINAL_INTERNAL_SERVICE_KEY?.length ?? 0) >= 32;
  const workspaceRoot = process.env.TERMINAL_WORKSPACE_ROOT ?? "";
  const workspaceReady = workspaceRoot.length > 0;

  const checks = {
    authConfigured,
    internalServiceConfigured,
    workspaceRoot: workspaceReady,
    docker: USE_DOCKER,
  };

  const allReady = authConfigured && internalServiceConfigured && workspaceReady;

  res.status(allReady ? 200 : 503).json({
    service: "terminal-server",
    readiness: allReady ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    checks,
    reasons: allReady
      ? []
      : [
          !authConfigured ? "TERMINAL_AUTH_SECRET not configured (min 32 chars)" : "",
          !internalServiceConfigured ? "TERMINAL_INTERNAL_SERVICE_KEY not configured (min 32 chars)" : "",
          !workspaceReady ? "TERMINAL_WORKSPACE_ROOT not set" : "",
        ].filter(Boolean),
  });
});

// Backward-compatible /health — returns readiness check
app.get("/health", (_req, res) => {
  const authConfigured = (process.env.TERMINAL_AUTH_SECRET?.length ?? 0) >= 32;
  const internalServiceConfigured = (process.env.TERMINAL_INTERNAL_SERVICE_KEY?.length ?? 0) >= 32;
  const workspaceRoot = process.env.TERMINAL_WORKSPACE_ROOT ?? "";
  const workspaceReady = workspaceRoot.length > 0;
  const allReady = authConfigured && internalServiceConfigured && workspaceReady;

  res.status(allReady ? 200 : 503).json({
    service: "terminal-server",
    status: allReady ? "ok" : "degraded",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    readiness: allReady ? "ready" : "not_ready",
    checks: {
      authConfigured,
      internalServiceConfigured,
      workspaceRoot: workspaceReady,
      docker: USE_DOCKER,
    },
    reasons: allReady
      ? []
      : [
          !authConfigured ? "TERMINAL_AUTH_SECRET not configured (min 32 chars)" : "",
          !internalServiceConfigured ? "TERMINAL_INTERNAL_SERVICE_KEY not configured (min 32 chars)" : "",
          !workspaceReady ? "TERMINAL_WORKSPACE_ROOT not set" : "",
        ].filter(Boolean),
  });
});

// ─── Internal workspace endpoints (service-to-service) ─────────
// These are only callable by the Next.js server using the shared
// internal service key. They are NOT callable from the browser.

/**
 * POST /internal/workspace/prepare
 * Provision a workspace for a project.
 *
 * Body for GitHub project:
 *   { sourceType: "github", userId, projectId, installationId, owner, repo, branch, githubToken? }
 *
 * Body for blank project:
 *   { sourceType: "blank", userId, projectId, templateId }
 *
 * Returns: { workspaceId, userId, projectId, root, branch, commitSha, ready }
 * Idempotent: if a workspace already exists for the projectId+userId, returns it.
 */
app.post("/internal/workspace/prepare", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    const userId = String(body.userId || "");
    const projectId = String(body.projectId || "");
    const sourceType = String(body.sourceType || "");

    if (!userId || !projectId || !sourceType) {
      res.status(400).json({ error: "Missing required fields: userId, projectId, sourceType" });
      return;
    }

    // Check for existing workspace (idempotent)
    const existingWs = listWorkspaces(userId).find((w: WorkspaceDescriptor) => w.projectId === projectId);
    if (existingWs && existingWs.ready) {
      const { workspaceId, root, branch, commitSha } = existingWs;
      res.json({ workspaceId, userId, projectId, root, branch, commitSha, ready: true });
      return;
    }

    let descriptor: WorkspaceDescriptor;

    if (sourceType === "blank") {
      const templateId = String(body.templateId || "blank-static");
      descriptor = await prepareBlankWorkspace({
        userId,
        projectId,
        workspaceRoot: WORKSPACE_ROOT,
        templateId,
      });
    } else if (sourceType === "github") {
      const installationId = Number(body.installationId);
      const owner = String(body.owner || "");
      const repo = String(body.repo || "");
      const branch = String(body.branch || "main");
      const githubToken = body.githubToken ? String(body.githubToken) : null;

      if (!installationId || !owner || !repo) {
        res.status(400).json({ error: "Missing GitHub fields: installationId, owner, repo" });
        return;
      }

      descriptor = await prepareWorkspace({
        userId,
        projectId,
        installationId,
        owner,
        repo,
        branch,
        commitSha: body.commitSha ? String(body.commitSha) : null,
        workspaceRoot: WORKSPACE_ROOT,
        githubToken,
      });
    } else {
      res.status(400).json({ error: `sourceType must be "github" or "blank"` });
      return;
    }

    res.json({
      workspaceId: descriptor.workspaceId,
      userId: descriptor.userId,
      projectId: descriptor.projectId,
      root: descriptor.root,
      branch: descriptor.branch,
      commitSha: descriptor.commitSha,
      ready: descriptor.ready,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace preparation failed";
    console.error("[Internal] Workspace prepare error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /internal/workspace/:workspaceId
 * Get workspace state. Verifies userId ownership.
 */
app.get("/internal/workspace/:workspaceId", requireInternalServiceAuth, (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.query.userId || "");

  if (!userId) {
    res.status(400).json({ error: "Missing userId query parameter" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json({
    workspaceId: ws.workspaceId,
    userId: ws.userId,
    projectId: ws.projectId,
    root: ws.root,
    branch: ws.branch,
    commitSha: ws.commitSha,
    ready: ws.ready,
  });
});

/**
 * POST /internal/workspace/:workspaceId/exec
 * Execute a command in the workspace. Service-to-service only.
 * Returns stdout, stderr, exit code, and duration.
 */
app.post("/internal/workspace/:workspaceId/exec", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.body?.userId || "");
  const command = String(req.body?.command || "");

  if (!userId || !command) {
    res.status(400).json({ error: "Missing userId or command" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!ws.ready) {
    res.status(409).json({ error: "Workspace not ready" });
    return;
  }

  // Block dangerous commands
  if (isBlockedCommand(command)) {
    res.status(403).json({ error: "Blocked unsafe command" });
    return;
  }

  const { execFile } = await import("child_process");
  const startTime = Date.now();

  // Determine the shell
  const isWin = process.platform === "win32";
  const shell = isWin ? "powershell.exe" : "bash";
  const shellArgs = isWin ? ["-NoProfile", "-Command", command] : ["-c", command];

  execFile(
    shell,
    shellArgs,
    {
      cwd: ws.root,
      timeout: 120000, // 2 minute timeout
      maxBuffer: 2 * 1024 * 1024, // 2MB
      env: { ...process.env, HOME: ws.root },
    },
    (err, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const exitCode = err ? (err as { code?: number }).code ?? -1 : 0;

      res.json({
        exitCode,
        stdout: Buffer.isBuffer(stdout) ? stdout.toString("utf-8") : (stdout ?? ""),
        stderr: Buffer.isBuffer(stderr) ? stderr.toString("utf-8") : (stderr ?? ""),
        durationMs,
      });
    },
  );
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

type AuthenticatedRequest = Request & {
  terminalUserId?: string;
  workspaceId?: string;
  workspaceRoot?: string;
};

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

// ─── Workspace-scoped file endpoints ───────────────────────────
// These endpoints require BOTH a terminal token (user auth) AND a
// workspaceId. They verify that the workspace belongs to the user
// and operate only within the workspace root.

function resolveWorkspacePath(workspaceId: string, userId: string, filePath: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error("Workspace not found");
  if (ws.userId !== userId) throw new Error("Forbidden");
  if (!ws.ready) throw new Error("Workspace not ready");

  if (filePath.length > MAX_PATH_LENGTH) {
    throw new Error("Path too long");
  }
  const target = resolve(ws.root, filePath);
  const pathFromRoot = relative(ws.root, target);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Invalid path — escapes workspace root");
  }
  return target;
}

/** Middleware: extract workspaceId from header and verify it belongs to the user. */
function requireWorkspaceAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = verifyTerminalToken(bearerToken(req.headers.authorization)).sub;
    req.terminalUserId = userId;
    const workspaceId = req.headers["x-workspace-id"] as string | undefined;
    if (!workspaceId) {
      res.status(400).json({ error: "Missing X-Workspace-Id header" });
      return;
    }
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    if (ws.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!ws.ready) {
      res.status(409).json({ error: "Workspace not ready" });
      return;
    }
    req.workspaceId = workspaceId;
    req.workspaceRoot = ws.root;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.use("/ws-files", requireWorkspaceAuth);

app.get("/ws-files", (req: AuthenticatedRequest, res) => {
  const dirPath = String(req.query.path || ".");
  try {
    const target = resolve(req.workspaceRoot!, dirPath);
    const rel = relative(req.workspaceRoot!, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const entries = readdirSync(target, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "folder" : "file",
    }));
    res.json({ entries, workspaceId: req.workspaceId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
  }
});

app.post("/ws-files/read", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  try {
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    const stats = statSync(target);
    if (!stats.isFile()) {
      return res.status(400).json({ error: "Not a file" });
    }
    if (stats.size > MAX_READ_SIZE) {
      return res.status(413).json({ error: `File exceeds max read size (${MAX_READ_SIZE} bytes)` });
    }
    const content = readFileSync(target, "utf-8");
    res.json({ content, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read file";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/ws-files/write", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  const content = String(req.body.content || "");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_SIZE) {
    return res.status(413).json({ error: `Content exceeds max write size (${MAX_WRITE_SIZE} bytes)` });
  }
  if (!filePath || filePath === ".") {
    return res.status(400).json({ error: "Refusing to write to workspace root" });
  }
  try {
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
    res.json({ saved: true, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to write file";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/ws-files/delete", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  if (!filePath || filePath === ".") {
    return res.status(400).json({ error: "Refusing to delete workspace root" });
  }
  try {
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    rmSync(target, { recursive: true, force: true });
    res.json({ deleted: true, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete file";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

io.use((socket, next) => {
  try {
    socket.data.userId = verifyTerminalToken(socket.handshake.auth?.token).sub;
    // Optional: accept workspaceId from handshake for project-bound PTY
    const workspaceId = socket.handshake.auth?.workspaceId;
    if (workspaceId) {
      const ws = getWorkspace(String(workspaceId));
      if (!ws) {
        next(new Error("Workspace not found"));
        return;
      }
      if (ws.userId !== socket.data.userId) {
        next(new Error("Forbidden"));
        return;
      }
      if (!ws.ready) {
        next(new Error("Workspace not ready"));
        return;
      }
      socket.data.workspaceId = ws.workspaceId;
      socket.data.workspaceRoot = ws.root;
      socket.data.projectId = ws.projectId;
    }
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.data.userId);
  const sessionId = randomUUID();
  const workspaceId = socket.data.workspaceId as string | undefined;
  const projectId = socket.data.projectId as string | undefined;

  // If a workspaceId was provided and verified, use the workspace root.
  // Otherwise fall back to the user's root workspace (legacy behavior).
  const workspace = (socket.data.workspaceRoot as string | undefined) ?? resolve(WORKSPACE_ROOT, userId);
  mkdirSync(workspace, { recursive: true });

  console.log("[Terminal] Connected:", { userId, sessionId, workspaceId: workspaceId ?? "default", projectId: projectId ?? "none" });

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
          LITTREE_WORKSPACE_ID: workspaceId ?? "",
          LITTREE_PROJECT_ID: projectId ?? "",
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
  socket.emit("session:ready", {
    sessionId,
    cwd: workspace,
    workspaceId: workspaceId ?? null,
    projectId: projectId ?? null,
    shell: process.platform === "win32" ? "powershell" : process.env.SHELL || "bash",
  });

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
    socket.emit("terminal:output", "\r\n\x1b[36mLiTT is thinking...\x1b[0m\r\n");
    try {
      const reply = await handleLiTTCodeCommand(input);
      socket.emit("terminal:output", "\r\n\x1b[36mLiTT:\x1b[0m\r\n");
      socket.emit("terminal:output", reply.replace(/\n/g, "\r\n") + "\r\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : "LiTT failed";
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

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[terminal-server] Received ${signal}, shutting down...`);
  for (const [id, session] of sessions) {
    try {
      session.ptyProcess.kill();
    } catch {}
    sessions.delete(id);
  }
  io.close(() => {
    server.close(() => {
      console.log("[terminal-server] All connections closed.");
      process.exit(0);
    });
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.error("[terminal-server] Forcing exit after timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
