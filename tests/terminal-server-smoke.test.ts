// @vitest-environment node
/**
 * Terminal Server Smoke Test
 *
 * Starts the real terminal-server as a child process, prepares a blank
 * workspace via the internal API, issues a terminal token, connects via
 * socket.io, and verifies the full PTY session lifecycle:
 *   1. Health endpoint responds
 *   2. Blank workspace preparation succeeds
 *   3. Socket.io connection with valid token → session:ready
 *   4. Terminal input produces output
 *   5. Workspace-not-found error on stale workspaceId
 *   6. Unauthorized rejection on missing/invalid token
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { createHmac, randomUUID } from "crypto";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { io as ioClient, type Socket } from "socket.io-client";

// ─── Test constants ─────────────────────────────────────────────
const SECRET = "test_terminal_auth_secret_32_chars_min";
const INTERNAL_KEY = "test_internal_service_key_32_chars_min!";
const PORT = 4099; // avoid clashing with dev port 4001
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;
const TERMINAL_SERVER_DIR = resolve(__dirname, "..", "terminal-server");
const SERVER_SCRIPT = join(TERMINAL_SERVER_DIR, "dist", "server.js");

// Unique temp workspace root per test run — cleaned up in afterAll
const WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "litt-smoke-"));

// ─── Helpers ────────────────────────────────────────────────────

/** Sign a terminal token matching terminal-server/auth.ts format. */
function signToken(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/** Create a valid terminal token for a user + optional workspace. */
function createToken(userId: string, workspaceId?: string, projectId?: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    sub: userId,
    aud: "littree-terminal",
    iat: now,
    exp: now + 300,
    ...(workspaceId ? { wid: workspaceId } : {}),
    ...(projectId ? { pid: projectId } : {}),
  });
}

/** Wait for the terminal server health endpoint to respond. */
async function waitForServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${BASE_URL}/health/live`);
      if (resp.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Terminal server did not become healthy within ${timeoutMs}ms`);
}

/** Prepare a blank workspace via the internal API. */
async function prepareBlankWorkspace(userId: string, projectId: string, templateId = "blank-static") {
  const resp = await fetch(`${BASE_URL}/internal/workspace/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": INTERNAL_KEY,
    },
    body: JSON.stringify({ sourceType: "blank", userId, projectId, templateId }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "unknown");
    throw new Error(`prepareBlankWorkspace failed (${resp.status}): ${text}`);
  }
  return (await resp.json()) as {
    workspaceId: string;
    userId: string;
    projectId: string;
    root: string;
    ready: boolean;
  };
}

/** Connect a socket.io client with the given token. */
function connectSocket(token: string): Socket {
  return ioClient(WS_URL, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    timeout: 5_000,
  });
}

/** Wait for a specific socket event, resolving with its data. */
function waitForEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.once("connect_error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Server lifecycle ───────────────────────────────────────────
let serverProcess: ChildProcess | null = null;

beforeAll(async () => {
  // Verify the server was built
  if (!existsSync(SERVER_SCRIPT)) {
    throw new Error(`Terminal server not built. Run 'pnpm --filter terminal-server build' first. Expected: ${SERVER_SCRIPT}`);
  }

  serverProcess = spawn("node", [SERVER_SCRIPT], {
    cwd: TERMINAL_SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      TERMINAL_AUTH_SECRET: SECRET,
      TERMINAL_INTERNAL_SERVICE_KEY: INTERNAL_KEY,
      TERMINAL_WORKSPACE_ROOT: WORKSPACE_ROOT,
      TERMINAL_ALLOWED_ORIGIN: "*",
      TERMINAL_USE_DOCKER: "false",
      NODE_ENV: "test",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[terminal-server] ${msg}`);
  });
  serverProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[terminal-server:err] ${msg}`);
  });

  await waitForServer();
}, 30_000);

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise<void>((r) => {
      serverProcess?.once("exit", () => r());
      setTimeout(() => {
        serverProcess?.kill("SIGKILL");
        r();
      }, 5_000);
    });
    serverProcess = null;
  }
  // Clean up temp workspaces
  try {
    rmSync(WORKSPACE_ROOT, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── Tests ──────────────────────────────────────────────────────

describe("terminal-server smoke test", () => {
  const userId = `smoke-user-${randomUUID().slice(0, 8)}`;
  const projectId = `smoke-project-${randomUUID().slice(0, 8)}`;
  let workspaceId: string;

  beforeEach(async () => {
    // Prepare a fresh blank workspace before each test that needs one
    const ws = await prepareBlankWorkspace(userId, projectId);
    workspaceId = ws.workspaceId;
  });

  it("responds on /health/live", async () => {
    const resp = await fetch(`${BASE_URL}/health/live`);
    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(body.service).toBe("terminal-server");
    expect(body.status).toBe("alive");
  });

  it("responds on /health/ready with auth + workspace configured", async () => {
    const resp = await fetch(`${BASE_URL}/health/ready`);
    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(body.checks.authConfigured).toBe(true);
    expect(body.checks.internalServiceConfigured).toBe(true);
    expect(body.checks.workspaceRoot).toBe(true);
  });

  it("prepares a blank workspace and returns a ready descriptor", async () => {
    const ws = await prepareBlankWorkspace(userId, `proj-${randomUUID().slice(0, 8)}`);
    expect(ws.workspaceId).toMatch(/^ws-/);
    expect(ws.ready).toBe(true);
    expect(ws.userId).toBe(userId);
    expect(existsSync(ws.root)).toBe(true);
  });

  it("connects via socket.io with a valid workspace-bound token and gets session:ready", async () => {
    const token = createToken(userId, workspaceId, projectId);
    const socket = connectSocket(token);

    try {
      const session = await waitForEvent<{
        sessionId: string;
        cwd: string;
        workspaceId: string;
        projectId: string;
        shell: string;
      }>(socket, "session:ready", 10_000);

      expect(session.sessionId).toBeTruthy();
      expect(session.workspaceId).toBe(workspaceId);
      expect(session.projectId).toBe(projectId);
      expect(session.cwd).toBeTruthy();
      expect(session.shell).toBeTruthy();
    } finally {
      socket.disconnect();
    }
  });

  it("echoes terminal output when input is sent", async () => {
    const token = createToken(userId, workspaceId, projectId);
    const socket = connectSocket(token);

    try {
      await waitForEvent(socket, "session:ready", 10_000);

      // Collect output for a short window after sending a command.
      // On Windows the shell is PowerShell; on Linux it's bash.
      // `echo smoke_test_marker` works in both.
      const outputPromise = new Promise<string>((resolve) => {
        let collected = "";
        const timer = setTimeout(() => resolve(collected), 5_000);
        socket.on("terminal:output", (data: string) => {
          collected += data;
          if (collected.includes("smoke_test_marker")) {
            clearTimeout(timer);
            resolve(collected);
          }
        });
      });

      // Send the command + Enter
      socket.emit("terminal:input", "echo smoke_test_marker\r");

      const output = await outputPromise;
      expect(output).toContain("smoke_test_marker");
    } finally {
      socket.disconnect();
    }
  });

  it("rejects a socket connection with a stale (non-existent) workspaceId", async () => {
    const fakeWorkspaceId = "ws-nonexistent-12345678";
    const token = createToken(userId, fakeWorkspaceId, projectId);
    const socket = connectSocket(token);

    try {
      const err = await waitForEvent<Error>(socket, "connect_error", 5_000);
      expect(err.message).toContain("Workspace not found");
    } finally {
      socket.disconnect();
    }
  });

  it("rejects a socket connection with no token", async () => {
    const socket = ioClient(WS_URL, {
      auth: {},
      transports: ["websocket"],
      reconnection: false,
      timeout: 5_000,
    });

    try {
      const err = await waitForEvent<Error>(socket, "connect_error", 5_000);
      expect(err.message).toMatch(/unauthorized|missing|invalid/i);
    } finally {
      socket.disconnect();
    }
  });

  it("rejects a socket connection with a forged token (wrong secret)", async () => {
    const forged = signToken({
      sub: userId,
      aud: "littree-terminal",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      wid: workspaceId,
      pid: projectId,
    });
    // Tamper: re-sign with wrong secret
    const encoded = forged.split(".")[0];
    const badSig = createHmac("sha256", "wrong-secret-32-chars-min!!!!!!").update(encoded).digest("base64url");
    const tamperedToken = `${encoded}.${badSig}`;

    const socket = connectSocket(tamperedToken);

    try {
      const err = await waitForEvent<Error>(socket, "connect_error", 5_000);
      expect(err.message).toMatch(/unauthorized|invalid/i);
    } finally {
      socket.disconnect();
    }
  });

  it("rejects internal API calls without the service key", async () => {
    const resp = await fetch(`${BASE_URL}/internal/workspace/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "blank", userId, projectId, templateId: "blank-static" }),
    });
    expect(resp.status).toBe(401);
  });

  it("returns 404 for a non-existent workspace via internal API", async () => {
    const resp = await fetch(`${BASE_URL}/internal/workspace/ws-nonexistent-99999999?userId=${userId}`, {
      headers: { "X-Internal-Service-Key": INTERNAL_KEY },
    });
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error).toBe("Workspace not found");
  });

  it("connects with an unbound token (no workspaceId) for a default session", async () => {
    const token = createToken(userId);
    const socket = connectSocket(token);

    try {
      const session = await waitForEvent<{
        sessionId: string;
        cwd: string;
        workspaceId: string | null;
      }>(socket, "session:ready", 10_000);

      expect(session.sessionId).toBeTruthy();
      expect(session.workspaceId).toBeNull();
      expect(session.cwd).toBeTruthy();
    } finally {
      socket.disconnect();
    }
  });
});
