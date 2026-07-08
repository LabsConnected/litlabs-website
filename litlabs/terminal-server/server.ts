import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { resolve, normalize } from "path";
import { spawnSync } from "child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { createClient } from "@supabase/supabase-js";
import { isBlockedCommand } from "./security";
import { createDockerSession } from "./docker-manager";
import { handleLiTCommand } from "./jarvis-ai";

const PORT = Number(process.env.PORT || process.env.TERMINAL_SERVER_PORT || 4001);
const ALLOWED_ORIGINS = (process.env.TERMINAL_ALLOWED_ORIGINS || process.env.TERMINAL_ALLOWED_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WORKSPACE_ROOT = process.env.TERMINAL_WORKSPACE_ROOT || resolve("/tmp/littree-workspaces");
const USE_DOCKER = process.env.TERMINAL_USE_DOCKER === "true";
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPO_URL = process.env.TERMINAL_REPO_URL;
const REPO_DIR = process.env.TERMINAL_REPO_DIR || (REPO_URL ? "litlabs" : "");
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const clerk = CLERK_SECRET ? createClerkClient({ secretKey: CLERK_SECRET }) : null;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

mkdirSync(WORKSPACE_ROOT, { recursive: true });

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "2mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

interface Session {
  ptyProcess: pty.IPty;
  createdAt: Date;
  userId: string;
  sessionId: string;
  cwd: string;
}

interface AuthenticatedRequest extends express.Request {
  userId?: string;
}

const sessions = new Map<string, Session>();

function getUserId(req: AuthenticatedRequest, bodyOrQuery?: { userId?: string }): string {
  return String(req.userId || bodyOrQuery?.userId || "dev-user");
}

async function verifyClerkToken(token: string): Promise<string | null> {
  if (!CLERK_SECRET) return null;
  try {
    const payload = await verifyToken(token, { secretKey: CLERK_SECRET });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!clerk) return next();
  try {
    const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.__session;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const userId = await verifyClerkToken(token);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    (req as AuthenticatedRequest).userId = userId;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

async function logCommand(userId: string, sessionId: string, command: string, output?: string) {
  if (!supabase) return;
  try {
    await supabase.from("terminal_logs").insert({ user_id: userId, session_id: sessionId, command, output: output?.slice(0, 4000), created_at: new Date().toISOString() });
  } catch (err) {
    console.error("[Supabase] log failed", err);
  }
}

async function logEvent(userId: string, event: string, details?: string) {
  if (!supabase) return;
  try {
    await supabase.from("terminal_logs").insert({ user_id: userId, session_id: "system", command: event, output: details?.slice(0, 4000), created_at: new Date().toISOString() });
  } catch (err) {
    console.error("[Supabase] log failed", err);
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size, docker: USE_DOCKER, clerk: !!clerk, supabase: !!supabase });
});

function getUserWorkspace(userId: string) {
  const workspace = resolve(WORKSPACE_ROOT, userId);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function getRepoPath(userId: string) {
  const workspace = getUserWorkspace(userId);
  return REPO_DIR ? resolve(workspace, REPO_DIR) : workspace;
}

function ensureRepoCloned(userId: string) {
  const repoPath = getRepoPath(userId);
  if (REPO_URL && !existsSync(resolve(repoPath, ".git"))) {
    const workspace = getUserWorkspace(userId);
    console.log(`[Terminal] Cloning repo for ${userId} from ${REPO_URL} into ${repoPath}`);
    const env = { ...process.env, GH_TOKEN, GITHUB_TOKEN: GH_TOKEN };
    let result = spawnSync("git", ["clone", REPO_URL, repoPath], { cwd: workspace, env, stdio: "pipe" });
    if (result.status !== 0) {
      const stderr = result.stderr?.toString() || "";
      console.error("[Terminal] git clone failed:", stderr);
      // Fall back to gh repo clone so GH_TOKEN is used for private repos
      if (GH_TOKEN) {
        result = spawnSync("gh", ["repo", "clone", REPO_URL, repoPath], { cwd: workspace, env, stdio: "pipe" });
        if (result.status !== 0) {
          console.error("[Terminal] gh repo clone failed:", result.stderr?.toString() || "");
        }
      }
    }
  }
  return repoPath;
}

function safePath(userId: string, filePath: string) {
  const workspace = getUserWorkspace(userId);
  const target = normalize(resolve(workspace, filePath));
  if (!target.startsWith(workspace)) {
    throw new Error("Invalid path");
  }
  return target;
}

app.get("/api/files", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.query as { userId?: string });
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

app.post("/api/files/create", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const filePath = String(req.body.path || "");
  const content = String(req.body.content || "");
  try {
    const target = safePath(userId, filePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
    res.json({ created: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create file" });
  }
});

app.post("/api/files/update", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const filePath = String(req.body.path || "");
  const content = String(req.body.content || "");
  try {
    const target = safePath(userId, filePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
    res.json({ saved: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update file" });
  }
});

app.post("/api/files/read", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    const content = readFileSync(target, "utf-8");
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
  }
});

app.post("/api/files/delete", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    rmSync(target, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete file" });
  }
});

app.post("/api/terminal/session", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const sessionId = req.body.sessionId || randomUUID();
  res.json({ sessionId, userId, status: "ready", workspace: getUserWorkspace(userId) });
});

const activeAgents = new Map<string, { running: boolean; startedAt: string }>();

app.post("/api/agents/run", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const agentId = String(req.body.agentId || "lit");
  const task = String(req.body.task || "execute");
  activeAgents.set(agentId, { running: true, startedAt: new Date().toISOString() });
  await logEvent(userId, "agent:run", `Agent ${agentId} started: ${task}`);
  res.json({ ok: true, agentId, status: "running" });
});

app.post("/api/agents/stop", requireAuth, (req: AuthenticatedRequest, res) => {
  const agentId = String(req.body.agentId || "lit");
  activeAgents.set(agentId, { running: false, startedAt: new Date().toISOString() });
  res.json({ ok: true, agentId, status: "stopped" });
});

app.get("/api/logs", requireAuth, async (req: AuthenticatedRequest, res) => {
  void req;
  if (!supabase) return res.json({ logs: [] });
  try {
    const { data, error } = await supabase.from("terminal_logs").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ logs: data || [] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch logs" });
  }
});

app.post("/api/deploy", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  await logEvent(userId, "deploy", "Deploy requested via terminal API");
  res.json({ ok: true, message: "Deploy request received. Connect Vercel webhook to complete." });
});

// Legacy routes preserved for backward compatibility
app.get("/files", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.query as { userId?: string });
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

app.post("/files/read", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    const content = readFileSync(target, "utf-8");
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
  }
});

app.post("/files/write", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
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

app.post("/files/delete", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req, req.body);
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    rmSync(target, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete file" });
  }
});

io.use(async (socket, next) => {
  const token = String(socket.handshake.auth?.token || "");
  if (!CLERK_SECRET || !token) return next();
  try {
    const userId = await verifyClerkToken(token);
    if (!userId) return next(new Error("Unauthorized"));
    socket.data.userId = userId;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.data.userId || socket.handshake.auth?.userId || "dev-user");
  const sessionId = String(socket.handshake.auth?.sessionId || randomUUID());

  console.log("[Terminal] Connected:", { userId, sessionId });

  const workspace = getUserWorkspace(userId);
  const cwd = ensureRepoCloned(userId);

  let ptyProcess: pty.IPty;

  try {
    if (USE_DOCKER) {
      ptyProcess = createDockerSession({
        userId,
        sessionId,
        workspace,
        cwd: REPO_DIR ? `/workspace/${REPO_DIR}` : "/workspace",
        env: GH_TOKEN ? { GH_TOKEN, GITHUB_TOKEN: GH_TOKEN } : undefined,
        onData: (data: string) => socket.emit("terminal:output", data),
      });
    } else {
      const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
      ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          LITTREE_USER_ID: userId,
          LITTREE_SESSION_ID: sessionId,
          HOME: workspace,
          ...(GH_TOKEN ? { GH_TOKEN, GITHUB_TOKEN: GH_TOKEN } : {}),
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
    cwd,
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

    if (data.includes("\r")) {
      const cmd = data.replace("\r", "").trim();
      if (cmd) logCommand(userId, sessionId, cmd).catch(() => { });
    }

    ptyProcess.write(data);
  });

  socket.on("lit:command", async (input: string) => {
    if (typeof input !== "string") return;
    socket.emit("terminal:output", "\r\n\x1b[36m🤖 LiT is thinking...\x1b[0m\r\n");
    try {
      const reply = await handleLiTCommand(input);
      socket.emit("terminal:output", "\r\n\x1b[36m🤖 LiT:\x1b[0m\r\n");
      socket.emit("terminal:output", reply.replace(/\n/g, "\r\n") + "\r\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : "LiT failed";
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
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   Workspace root: ${WORKSPACE_ROOT}`);
  console.log(`   Docker mode: ${USE_DOCKER}`);
});
