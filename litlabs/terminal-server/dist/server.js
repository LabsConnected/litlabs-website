"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const pty = __importStar(require("node-pty"));
const crypto_1 = require("crypto");
const path_1 = require("path");
const fs_1 = require("fs");
const backend_1 = require("@clerk/backend");
const supabase_js_1 = require("@supabase/supabase-js");
const security_1 = require("./security");
const docker_manager_1 = require("./docker-manager");
const jarvis_ai_1 = require("./jarvis-ai");
const PORT = Number(process.env.PORT || process.env.TERMINAL_SERVER_PORT || 4001);
const ALLOWED_ORIGINS = (process.env.TERMINAL_ALLOWED_ORIGINS || process.env.TERMINAL_ALLOWED_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const WORKSPACE_ROOT = process.env.TERMINAL_WORKSPACE_ROOT || (0, path_1.resolve)("/tmp/littree-workspaces");
const USE_DOCKER = process.env.TERMINAL_USE_DOCKER === "true";
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clerk = CLERK_SECRET ? (0, backend_1.createClerkClient)({ secretKey: CLERK_SECRET }) : null;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;
(0, fs_1.mkdirSync)(WORKSPACE_ROOT, { recursive: true });
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin))
            return callback(null, true);
        callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: "2mb" }));
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS,
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"],
});
const sessions = new Map();
function getUserId(req, bodyOrQuery) {
    return String(req.userId || bodyOrQuery?.userId || "dev-user");
}
async function verifyClerkToken(token) {
    if (!CLERK_SECRET)
        return null;
    try {
        const payload = await (0, backend_1.verifyToken)(token, { secretKey: CLERK_SECRET });
        return typeof payload.sub === "string" ? payload.sub : null;
    }
    catch {
        return null;
    }
}
async function requireAuth(req, res, next) {
    if (!clerk)
        return next();
    try {
        const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.__session;
        if (!token)
            return res.status(401).json({ error: "Unauthorized" });
        const userId = await verifyClerkToken(token);
        if (!userId)
            return res.status(401).json({ error: "Unauthorized" });
        req.userId = userId;
        next();
    }
    catch {
        res.status(401).json({ error: "Unauthorized" });
    }
}
async function logCommand(userId, sessionId, command, output) {
    if (!supabase)
        return;
    try {
        await supabase.from("terminal_logs").insert({ user_id: userId, session_id: sessionId, command, output: output?.slice(0, 4000), created_at: new Date().toISOString() });
    }
    catch (err) {
        console.error("[Supabase] log failed", err);
    }
}
async function logEvent(userId, event, details) {
    if (!supabase)
        return;
    try {
        await supabase.from("terminal_logs").insert({ user_id: userId, session_id: "system", command: event, output: details?.slice(0, 4000), created_at: new Date().toISOString() });
    }
    catch (err) {
        console.error("[Supabase] log failed", err);
    }
}
app.get("/health", (_req, res) => {
    res.json({ ok: true, sessions: sessions.size, docker: USE_DOCKER, clerk: !!clerk, supabase: !!supabase });
});
function getUserWorkspace(userId) {
    const workspace = (0, path_1.resolve)(WORKSPACE_ROOT, userId);
    (0, fs_1.mkdirSync)(workspace, { recursive: true });
    return workspace;
}
function safePath(userId, filePath) {
    const workspace = getUserWorkspace(userId);
    const target = (0, path_1.normalize)((0, path_1.resolve)(workspace, filePath));
    if (!target.startsWith(workspace)) {
        throw new Error("Invalid path");
    }
    return target;
}
app.get("/api/files", requireAuth, (req, res) => {
    const userId = getUserId(req, req.query);
    const dirPath = String(req.query.path || ".");
    try {
        const target = safePath(userId, dirPath);
        const entries = (0, fs_1.readdirSync)(target, { withFileTypes: true }).map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "folder" : "file",
        }));
        res.json({ entries });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
    }
});
app.post("/api/files/create", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const filePath = String(req.body.path || "");
    const content = String(req.body.content || "");
    try {
        const target = safePath(userId, filePath);
        (0, fs_1.mkdirSync)((0, path_1.resolve)(target, ".."), { recursive: true });
        (0, fs_1.writeFileSync)(target, content, "utf-8");
        res.json({ created: true, path: filePath });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create file" });
    }
});
app.post("/api/files/update", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const filePath = String(req.body.path || "");
    const content = String(req.body.content || "");
    try {
        const target = safePath(userId, filePath);
        (0, fs_1.mkdirSync)((0, path_1.resolve)(target, ".."), { recursive: true });
        (0, fs_1.writeFileSync)(target, content, "utf-8");
        res.json({ saved: true, path: filePath });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update file" });
    }
});
app.post("/api/files/read", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const filePath = String(req.body.path || "");
    try {
        const target = safePath(userId, filePath);
        const content = (0, fs_1.readFileSync)(target, "utf-8");
        res.json({ content });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
    }
});
app.post("/api/files/delete", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const filePath = String(req.body.path || "");
    try {
        const target = safePath(userId, filePath);
        (0, fs_1.rmSync)(target, { recursive: true, force: true });
        res.json({ deleted: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete file" });
    }
});
app.post("/api/terminal/session", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const sessionId = req.body.sessionId || (0, crypto_1.randomUUID)();
    res.json({ sessionId, userId, status: "ready", workspace: getUserWorkspace(userId) });
});
const activeAgents = new Map();
app.post("/api/agents/run", requireAuth, async (req, res) => {
    const userId = getUserId(req, req.body);
    const agentId = String(req.body.agentId || "jarvis");
    const task = String(req.body.task || "execute");
    activeAgents.set(agentId, { running: true, startedAt: new Date().toISOString() });
    await logEvent(userId, "agent:run", `Agent ${agentId} started: ${task}`);
    res.json({ ok: true, agentId, status: "running" });
});
app.post("/api/agents/stop", requireAuth, (req, res) => {
    const agentId = String(req.body.agentId || "jarvis");
    activeAgents.set(agentId, { running: false, startedAt: new Date().toISOString() });
    res.json({ ok: true, agentId, status: "stopped" });
});
app.get("/api/logs", requireAuth, async (req, res) => {
    void req;
    if (!supabase)
        return res.json({ logs: [] });
    try {
        const { data, error } = await supabase.from("terminal_logs").select("*").order("created_at", { ascending: false }).limit(100);
        if (error)
            throw error;
        res.json({ logs: data || [] });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch logs" });
    }
});
app.post("/api/deploy", requireAuth, async (req, res) => {
    const userId = getUserId(req, req.body);
    await logEvent(userId, "deploy", "Deploy requested via terminal API");
    res.json({ ok: true, message: "Deploy request received. Connect Vercel webhook to complete." });
});
// Legacy routes preserved for backward compatibility
app.get("/files", requireAuth, (req, res) => {
    const userId = getUserId(req, req.query);
    const dirPath = String(req.query.path || ".");
    try {
        const target = safePath(userId, dirPath);
        const entries = (0, fs_1.readdirSync)(target, { withFileTypes: true }).map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "folder" : "file",
        }));
        res.json({ entries });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
    }
});
app.post("/files/read", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const filePath = String(req.body.path || "");
    try {
        const target = safePath(userId, filePath);
        const content = (0, fs_1.readFileSync)(target, "utf-8");
        res.json({ content });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
    }
});
app.post("/files/write", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const filePath = String(req.body.path || "");
    const content = String(req.body.content || "");
    try {
        const target = safePath(userId, filePath);
        (0, fs_1.mkdirSync)((0, path_1.resolve)(target, ".."), { recursive: true });
        (0, fs_1.writeFileSync)(target, content, "utf-8");
        res.json({ saved: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to write file" });
    }
});
app.post("/files/delete", requireAuth, (req, res) => {
    const userId = getUserId(req, req.body);
    const filePath = String(req.body.path || "");
    try {
        const target = safePath(userId, filePath);
        (0, fs_1.rmSync)(target, { recursive: true, force: true });
        res.json({ deleted: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete file" });
    }
});
io.use(async (socket, next) => {
    const token = String(socket.handshake.auth?.token || "");
    if (!CLERK_SECRET || !token)
        return next();
    try {
        const userId = await verifyClerkToken(token);
        if (!userId)
            return next(new Error("Unauthorized"));
        socket.data.userId = userId;
        next();
    }
    catch {
        next(new Error("Unauthorized"));
    }
});
io.on("connection", (socket) => {
    const userId = String(socket.data.userId || socket.handshake.auth?.userId || "dev-user");
    const sessionId = String(socket.handshake.auth?.sessionId || (0, crypto_1.randomUUID)());
    console.log("[Terminal] Connected:", { userId, sessionId });
    const workspace = (0, path_1.resolve)(WORKSPACE_ROOT, userId);
    (0, fs_1.mkdirSync)(workspace, { recursive: true });
    let ptyProcess;
    try {
        if (USE_DOCKER) {
            ptyProcess = (0, docker_manager_1.createDockerSession)({
                userId,
                sessionId,
                workspace,
                onData: (data) => socket.emit("terminal:output", data),
            });
        }
        else {
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start terminal";
        console.error("[Terminal] Start failed:", message);
        socket.emit("terminal:error", message);
        socket.disconnect();
        return;
    }
    const session = {
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
    socket.on("terminal:input", (data) => {
        if (typeof data !== "string")
            return;
        if ((0, security_1.isBlockedCommand)(data)) {
            socket.emit("terminal:output", "\r\n\x1b[31m⛔ Blocked unsafe command.\x1b[0m\r\n");
            return;
        }
        if (data.includes("\r")) {
            const cmd = data.replace("\r", "").trim();
            if (cmd)
                logCommand(userId, sessionId, cmd).catch(() => { });
        }
        ptyProcess.write(data);
    });
    socket.on("jarvis:command", async (input) => {
        if (typeof input !== "string")
            return;
        socket.emit("terminal:output", "\r\n\x1b[36m🤖 Jarvis is thinking...\x1b[0m\r\n");
        try {
            const reply = await (0, jarvis_ai_1.handleJarvisCommand)(input);
            socket.emit("terminal:output", "\r\n\x1b[36m🤖 Jarvis:\x1b[0m\r\n");
            socket.emit("terminal:output", reply.replace(/\n/g, "\r\n") + "\r\n");
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Jarvis failed";
            socket.emit("terminal:output", `\r\n\x1b[31m⚠ ${message}\x1b[0m\r\n`);
        }
    });
    socket.on("terminal:resize", ({ cols, rows }) => {
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
