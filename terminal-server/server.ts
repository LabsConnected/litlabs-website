import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { resolve, normalize } from "path";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { isBlockedCommand } from "./security";
import { createDockerSession } from "./docker-manager";
import { handleJarvisCommand } from "./jarvis-ai";

const PORT = Number(process.env.PORT || process.env.TERMINAL_SERVER_PORT || 4001);
const ALLOWED_ORIGIN = process.env.TERMINAL_ALLOWED_ORIGIN || "http://localhost:3000";
const WORKSPACE_ROOT = process.env.TERMINAL_WORKSPACE_ROOT || resolve("/tmp/littree-workspaces");
const USE_DOCKER = process.env.TERMINAL_USE_DOCKER === "true";

mkdirSync(WORKSPACE_ROOT, { recursive: true });

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());

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
  res.json({ ok: true, sessions: sessions.size, docker: USE_DOCKER });
});

function getUserWorkspace(userId: string) {
  const workspace = resolve(WORKSPACE_ROOT, userId);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function safePath(userId: string, filePath: string) {
  const workspace = getUserWorkspace(userId);
  const target = normalize(resolve(workspace, filePath));
  if (!target.startsWith(workspace)) {
    throw new Error("Invalid path");
  }
  return target;
}

app.get("/files", (req, res) => {
  const userId = String(req.query.userId || "dev-user");
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

app.post("/files/read", (req, res) => {
  const userId = String(req.body.userId || "dev-user");
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    const content = readFileSync(target, "utf-8");
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
  }
});

app.post("/files/write", (req, res) => {
  const userId = String(req.body.userId || "dev-user");
  const filePath = String(req.body.path || "");
  const content = String(req.body.content || "");
  try {
    const target = safePath(userId, filePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to write file" });
  }
});

app.post("/files/delete", (req, res) => {
  const userId = String(req.body.userId || "dev-user");
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    rmSync(target, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete file" });
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.handshake.auth?.userId || "dev-user");
  const sessionId = String(socket.handshake.auth?.sessionId || randomUUID());

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

  socket.on("jarvis:command", async (input: string) => {
    if (typeof input !== "string") return;
    socket.emit("terminal:output", "\r\n\x1b[36m🤖 Jarvis is thinking...\x1b[0m\r\n");
    try {
      const reply = await handleJarvisCommand(input);
      socket.emit("terminal:output", "\r\n\x1b[36m🤖 Jarvis:\x1b[0m\r\n");
      socket.emit("terminal:output", reply.replace(/\n/g, "\r\n") + "\r\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Jarvis failed";
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
