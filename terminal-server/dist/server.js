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
const security_1 = require("./security");
const docker_manager_1 = require("./docker-manager");
const jarvis_ai_1 = require("./jarvis-ai");
const PORT = Number(process.env.PORT || process.env.TERMINAL_SERVER_PORT || 4001);
const ALLOWED_ORIGIN = process.env.TERMINAL_ALLOWED_ORIGIN || "http://localhost:3000";
const WORKSPACE_ROOT = process.env.TERMINAL_WORKSPACE_ROOT || (0, path_1.resolve)("/tmp/littree-workspaces");
const USE_DOCKER = process.env.TERMINAL_USE_DOCKER === "true";
(0, fs_1.mkdirSync)(WORKSPACE_ROOT, { recursive: true });
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express_1.default.json());
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ALLOWED_ORIGIN,
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});
const sessions = new Map();
app.get("/health", (_req, res) => {
    const entries = (0, fs_1.existsSync)(WORKSPACE_ROOT) ? (0, fs_1.readdirSync)(WORKSPACE_ROOT, { withFileTypes: true }) : [];
    const repoRoot = entries.find((entry) => entry.isDirectory())?.name;
    const workspace = repoRoot ? (0, path_1.resolve)(WORKSPACE_ROOT, repoRoot) : WORKSPACE_ROOT;
    res.json({
        ok: true,
        sessions: sessions.size,
        docker: USE_DOCKER,
        clerk: Boolean(process.env.CLERK_SECRET_KEY),
        supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        shells: { ubuntu: process.platform !== "win32", powershell: process.platform === "win32" },
        workspace: {
            root: WORKSPACE_ROOT,
            exists: (0, fs_1.existsSync)(WORKSPACE_ROOT),
            repoCloned: (0, fs_1.existsSync)((0, path_1.resolve)(workspace, ".git")),
            packageJson: (0, fs_1.existsSync)((0, path_1.resolve)(workspace, "package.json")),
            nodeModules: (0, fs_1.existsSync)((0, path_1.resolve)(workspace, "node_modules")),
        },
    });
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
app.get("/files", (req, res) => {
    const userId = String(req.query.userId || "dev-user");
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
app.post("/files/read", (req, res) => {
    const userId = String(req.body.userId || "dev-user");
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
app.post("/files/write", (req, res) => {
    const userId = String(req.body.userId || "dev-user");
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
app.post("/files/delete", (req, res) => {
    const userId = String(req.body.userId || "dev-user");
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
io.on("connection", (socket) => {
    const userId = String(socket.handshake.auth?.userId || "dev-user");
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
    console.log(`   Allowed origin: ${ALLOWED_ORIGIN}`);
    console.log(`   Workspace root: ${WORKSPACE_ROOT}`);
    console.log(`   Docker mode: ${USE_DOCKER}`);
});
