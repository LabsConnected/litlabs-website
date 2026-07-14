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

io.use((socket, next) => {
  try {
    socket.data.userId = verifyTerminalToken(socket.handshake.auth?.token).sub;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.data.userId);
  const sessionId = randomUUID();

  console.log("[Terminal] Connected:", { userId, sessionId });

  const workspace = resolve(WORKSPACE_ROOT, userId);
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
