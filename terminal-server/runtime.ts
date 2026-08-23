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
import {
  RuntimeStore,
  createInitialState,
  createShellExecutor,
  createCommandExecutor,
  createExecutionGateway,
  createDefaultRegistry,
  type ExecutionGateway,
  type MissionMode,
  type ToolRegistry,
  type ShellExecutor,
  type CommandExecutor,
} from "@litt/agent-core";
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

// ─── ExecutionGateway — the ONE canonical execution authority ──────
//
// terminal-server previously had NO gateway instance. Slash commands
// like `/do` called child_process.execFile directly, bypassing the
// canonical ExecutionGateway → CommandExecutor → ShellExecutor path.
//
// This singleton is the ONE gateway for terminal-server. It shares the
// same RuntimeStore as everything else. `/do` (and any other mutating
// command) must route through `getExecutionGateway()` — never call
// execFile directly.
//
// The gateway is created lazily on first access so module-load order
// does not matter (the store must exist first).
//
// The tool registry, shell executor, and command executor are also
// exposed so the canonical LiTT operator (runAgentLoop) can reuse the
// SAME instances — no second tool registry, no second shell.

let gateway: ExecutionGateway | null = null;
let gatewayCwd: string | null = null;
let canonicalShell: ShellExecutor | null = null;
let canonicalTools: ToolRegistry | null = null;
let canonicalExecutor: CommandExecutor | null = null;

/**
 * Build (or rebuild) the canonical execution stack for a given cwd.
 * All pieces share the same RuntimeStore.
 */
function buildCanonicalStack(cwd: string): void {
  canonicalShell = createShellExecutor(cwd);
  canonicalExecutor = createCommandExecutor(canonicalShell, store, null);
  canonicalTools = createDefaultRegistry();
  gateway = createExecutionGateway({
    tools: canonicalTools,
    shell: canonicalShell,
    executor: canonicalExecutor,
    store,
    projectId: "terminal-server",
    // Identity-aware approval callback. The gateway still mints a real
    // VerifiedApproval through the approvalProvider (SEC-4) — this callback
    // only decides whether the human approved. It does NOT bypass
    // cryptographic verification.
    //
    // Only a direct, trusted, interactive human action counts as approval.
    //   - /do (command-registry.ts): trusted + interactive → approved
    //   - agent/operator path (runAgentLoop): untrusted → denied
    //   - headless/automated callers: denied (fail closed)
    //
    // PLAN mode and destructive commands are still denied by policy
    // BEFORE this callback is consulted — the callback only fires when
    // policy returns "require_approval".
    onApprovalRequired: async (request) => {
      return (
        request.identity.trusted === true &&
        request.identity.interaction === "interactive"
      );
    },
  });
  gatewayCwd = cwd;
}

/**
 * Get the canonical ExecutionGateway for terminal-server.
 * The gateway is bound to a working directory — calling this with a
 * different cwd rebuilds the stack for that cwd (the ShellExecutor is
 * cwd-bound). The RuntimeStore is shared across all instances.
 */
export function getExecutionGateway(cwd: string, mode: MissionMode = "act"): ExecutionGateway {
  if (gateway && gatewayCwd === cwd) {
    return gateway;
  }
  buildCanonicalStack(cwd);
  return gateway!;
}

/**
 * Get the canonical ToolRegistry — the SAME instance used by the
 * ExecutionGateway. The LiTT operator (runAgentLoop) must use this,
 * never create its own ToolRegistry.
 */
export function getCanonicalToolRegistry(cwd: string): ToolRegistry {
  if (!canonicalTools || gatewayCwd !== cwd) {
    buildCanonicalStack(cwd);
  }
  return canonicalTools!;
}

/**
 * Get the canonical ShellExecutor — the SAME instance used by the
 * ExecutionGateway and CommandExecutor.
 */
export function getCanonicalShell(cwd: string): ShellExecutor {
  if (!canonicalShell || gatewayCwd !== cwd) {
    buildCanonicalStack(cwd);
  }
  return canonicalShell!;
}

/**
 * Get the canonical CommandExecutor — the SAME instance used by the
 * ExecutionGateway.
 */
export function getCanonicalCommandExecutor(cwd: string): CommandExecutor {
  if (!canonicalExecutor || gatewayCwd !== cwd) {
    buildCanonicalStack(cwd);
  }
  return canonicalExecutor!;
}