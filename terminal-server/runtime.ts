/**
 * Canonical runtime authority for terminal-server.
 *
 * One RuntimeStore instance owns the truth. Socket.IO clients receive
 * a full snapshot on connect and incremental updates on mutation.
 *
 *   RuntimeStore = authority
 *         ↓
 *   terminal-server/server.ts
 *         ↓
 *   Socket.IO runtime snapshot/events
 *         ├── PowerShell
 *         └── litbit-web
 *
 * server.ts does NOT create another parallel state object.
 */

import { Server } from "socket.io";
import { RuntimeStore, createInitialState } from "@litt/agent-core";
import type { RuntimeEvent, RuntimeState } from "@litt/agent-core";

// ─── Singleton store ──────────────────────────────────────────────

const store = new RuntimeStore();

// ─── Socket.IO integration ────────────────────────────────────────

let io: Server | null = null;
let heartbeatStarted = false;

/**
 * Wire the RuntimeStore to a Socket.IO server.
 * Call once at server startup, after `io` is created.
 */
export function initRuntime(socketServer: Server): void {
  io = socketServer;

  // Emit a full snapshot to all clients on connect
  io.on("connection", (socket) => {
    socket.emit("runtime:snapshot", store.getState());
  });

  // Wire store events → Socket.IO broadcasts
  store.setEmitter((event: RuntimeEvent) => {
    if (!io) return;
    // Broadcast every state mutation to all connected clients
    io.emit("runtime:event", event);
    // Also emit a lightweight state update for convenience
    io.emit("runtime:state", store.getState());
  });

  // Start heartbeat if not already running
  if (!heartbeatStarted) {
    startServerHeartbeat();
    heartbeatStarted = true;
  }
}

/**
 * Heartbeat probe — pings the server's own health endpoint.
 * Returns latency in ms, or throws on failure.
 */
async function serverHealthProbe(): Promise<number> {
  const port = Number(process.env.PORT || process.env.TERMINAL_SERVER_PORT || 4001);
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/health/live`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Health probe failed: ${res.status}`);
  return Date.now() - t0;
}

function startServerHeartbeat(): void {
  store.setHeartbeatProbe(serverHealthProbe);
  store.configureHeartbeat({
    intervalMs: 15_000,
    maxFailures: 3,
  });
  store.startHeartbeat();
}

// ─── Public API for server.ts ─────────────────────────────────────

/**
 * Get the canonical RuntimeStore.
 * server.ts should use this — never create its own.
 */
export function getRuntimeStore(): RuntimeStore {
  return store;
}

/**
 * Get the current runtime state snapshot.
 */
export function getRuntimeState(): RuntimeState {
  return store.getState();
}

/**
 * Mark a command as started (for litt-code:command handler).
 */
export function runtimeCommandStart(command: string, args: string[], cwd: string): void {
  store.commandStart(command, args, cwd);
}

/**
 * Mark a command as finished (for litt-code:command handler).
 */
export function runtimeCommandEnd(
  command: string,
  success: boolean,
  exitCode: number | null,
  durationMs: number,
  message: string,
): void {
  store.commandEnd(command, success, exitCode, durationMs, message);
}

/**
 * Update project/git state from a status check.
 */
export function runtimeSetProject(project: {
  root: string;
  name: string;
  branch: string | null;
  remote: string | null;
  isGitRepo: boolean;
}): void {
  store.setProject(project);
}

export function runtimeSetGitChanges(count: number): void {
  store.setGitChanges(count);
}

/**
 * Update online/ping state.
 */
export function runtimeSetOnline(online: boolean, pingMs: number): void {
  store.setOnline(online, pingMs);
}

/**
 * Update model/profile.
 */
export function runtimeSetModel(model: string | null, profile: string | null): void {
  store.setModel(model, profile);
}

/**
 * Update phase.
 */
export function runtimeSetPhase(phase: "idle" | "thinking" | "verifying" | "complete" | "failed" | "running"): void {
  store.setPhase(phase);
}
