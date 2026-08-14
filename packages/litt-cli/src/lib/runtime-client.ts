/**
 * RuntimeClient — canonical runtime truth for the LiTT CLI.
 *
 * Socket.IO is the primary transport. REST is the fallback for environments
 * where Socket.IO is blocked or not yet connected.
 *
 *   CLI cockpit  →  RuntimeClient  →  terminal-server RuntimeStore
 *        ↑              ↓                    ↓
 *     displays     Socket.IO events     canonical state
 *
 * The CLI NEVER guesses state. It reads the canonical RuntimeState snapshot
 * and listens for RuntimeEvents. No fake "WORKING" indicators.
 */

import { io, type Socket } from "socket.io-client";
import { createHmac } from "node:crypto";
import type { RuntimeState, RuntimeEvent } from "@litt/agent-core";

// ─── Types ────────────────────────────────────────────────────────

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface RuntimeClientOptions {
  terminalUrl?: string;
  authSecret?: string;
  internalKey?: string;
  userId?: string;
  /** Max reconnection attempts before falling back to REST-only */
  maxReconnectAttempts?: number;
}

export interface LifecycleEvent {
  type:
    | "run.started"
    | "tool.started"
    | "tool.stdout"
    | "tool.stderr"
    | "tool.completed"
    | "tool.failed"
    | "tool.cancelled"
    | "tool.timeout"
    | "run.completed";
  runId: string;
  toolCallId?: string;
  ts: number;
  data: Record<string, unknown>;
}

export type LifecycleListener = (event: LifecycleEvent) => void;
export type StateListener = (state: RuntimeState) => void;
export type ConnectionListener = (state: ConnectionState) => void;
export type ErrorListener = (error: { code: string; message: string }) => void;

// ─── Token minting (matches terminal-server/auth.ts) ──────────────

function mintTerminalToken(userId: string, secret: string): string {
  const payload = {
    sub: userId,
    aud: "littree-terminal",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

// ─── RuntimeClient ────────────────────────────────────────────────

const DEFAULT_TERMINAL_URL = "http://127.0.0.1:4001";

export class RuntimeClient {
  private socket: Socket | null = null;
  private state: RuntimeState | null = null;
  private connectionState: ConnectionState = "disconnected";
  private currentRunId: string | null = null;
  private knownOldRuns: Set<string> = new Set();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;

  // ─── Hardening: duplicate suppression ──────────────────────────
  /** Event IDs we've already seen — prevents duplicate processing */
  private seenEventIds: Set<string> = new Set();
  /** Max size of the seen-event set (prevent unbounded growth) */
  private readonly maxSeenEvents = 10000;

  // ─── Hardening: event ordering ─────────────────────────────────
  /** Highest event timestamp we've processed — reject older events */
  private lastEventTs = 0;
  /** Whether to enforce strict ordering (reject out-of-order events) */
  private enforceOrdering = true;

  // ─── Hardening: exponential backoff ────────────────────────────
  private backoffMs = 1000;
  private readonly backoffMaxMs = 30000;
  private readonly backoffFactor = 1.5;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Hardening: reconnect snapshot tracking ────────────────────
  /** Timestamp of the last reconnect — events before this are stale */
  private lastReconnectTs = 0;
  /** Whether we're waiting for a post-reconnect snapshot */
  private awaitingSnapshot = false;

  private listeners = {
    lifecycle: new Set<LifecycleListener>(),
    state: new Set<StateListener>(),
    connection: new Set<ConnectionListener>(),
    error: new Set<ErrorListener>(),
  };

  private readonly terminalUrl: string;
  private readonly authSecret: string;
  private readonly internalKey: string;
  private readonly userId: string;

  constructor(options: RuntimeClientOptions = {}) {
    this.terminalUrl = options.terminalUrl ?? process.env.LITT_TERMINAL_URL ?? DEFAULT_TERMINAL_URL;
    this.authSecret = options.authSecret ?? process.env.TERMINAL_AUTH_SECRET ?? "";
    this.internalKey = options.internalKey ?? process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
    this.userId = options.userId ?? "cli-user";
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;

    // Install a permanent error listener so Socket.IO 'error' events
    // never crash the process via Node's unhandled-error behavior.
    // This is a safety net — actual error handling goes through
    // emitRuntimeError() → onError listeners.
    this.listeners.error.add(() => { /* safety net — prevents crash */ });
  }

  // ─── Connection ────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.socket?.connected) return;
    this.setConnectionState("connecting");

    if (this.authSecret.length < 32) {
      throw new Error(
        "TERMINAL_AUTH_SECRET not configured (min 32 chars). " +
        "Set it in your environment.",
      );
    }

    const token = mintTerminalToken(this.userId, this.authSecret);

    this.socket = io(this.terminalUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    this.wireSocketEvents();
  }

  private wireSocketEvents(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      this.reconnectAttempts = 0;
      this.backoffMs = 1000; // reset backoff
      this.lastReconnectTs = Date.now();
      this.awaitingSnapshot = true;
      this.setConnectionState("connected");

      // Request a fresh canonical snapshot immediately after connect.
      // The server should emit runtime:snapshot on connect, but we
      // also explicitly request it to guarantee resync.
      this.socket?.emit("runtime:request-snapshot");

      // Also fetch state via REST as a backup — no locally invented state
      this.fetchState().catch(() => { /* REST may not be available yet */ });
    });

    this.socket.on("disconnect", (reason: string) => {
      this.setConnectionState("disconnected");
      // Mark that we need reconciliation on reconnect
      this.awaitingSnapshot = true;

      // Socket.IO will auto-reconnect for most reasons.
      // For server-initiated disconnect, we need to manually reconnect
      // with exponential backoff.
      if (reason === "io server disconnect") {
        this.scheduleBackoffReconnect();
      }
    });

    this.socket.on("connect_error", () => {
      this.reconnectAttempts++;
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        this.setConnectionState("reconnecting");
        // Socket.IO handles its own backoff, but we also track it
        // for the manual reconnect path (server disconnect case)
      } else {
        this.setConnectionState("error");
      }
    });

    // Canonical runtime snapshot — received on connect and after reconnect
    this.socket.on("runtime:snapshot", (snapshot: RuntimeState) => {
      this.awaitingSnapshot = false;
      // Reconcile: if the server says idle but we think a run is active,
      // the run was lost during disconnect. Clear our local run tracking.
      if (snapshot.activeCommand == null && this.currentRunId) {
        this.knownOldRuns.add(this.currentRunId);
        this.currentRunId = null;
      }
      // If the server says a run is active, adopt it as the current run
      if (snapshot.activeCommand?.runId) {
        this.currentRunId = snapshot.activeCommand.runId;
      }
      this.state = snapshot;
      this.notifyStateListeners();
    });

    // Incremental state updates
    this.socket.on("runtime:state", (newState: RuntimeState) => {
      this.state = newState;
      this.notifyStateListeners();
    });

    // Runtime events — map to lifecycle events (with hardening)
    this.socket.on("runtime:event", (event: RuntimeEvent) => {
      this.handleRuntimeEvent(event);
    });
  }

  // ─── Hardening: exponential backoff reconnect ──────────────────

  private scheduleBackoffReconnect(): void {
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    const delay = Math.min(this.backoffMs, this.backoffMaxMs);
    this.backoffTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * this.backoffFactor, this.backoffMaxMs);
      this.socket?.connect();
    }, delay);
  }

  // ─── Event mapping ─────────────────────────────────────────────

  private handleRuntimeEvent(event: RuntimeEvent): void {
    // ─── Hardening: reject events with missing/malformed runId ───
    // Events without a runId are malformed — don't process them.
    // The only exception is phase_change which may not carry a runId.
    if (!event.runId && event.type !== "phase_change" && event.type !== "litt_event") {
      return;
    }

    // ─── Hardening: stale runId rejection ────────────────────────
    // Reject events from known-old runs (pre-reconnect or superseded)
    if (event.runId && this.knownOldRuns.has(event.runId)) {
      return;
    }

    // ─── Hardening: stale pre-reconnect event rejection ──────────
    // If we just reconnected and are awaiting a snapshot, reject any
    // events with timestamps before the reconnect. This prevents
    // buffered/delayed events from before the disconnect from
    // polluting the post-reconnect state.
    if (this.awaitingSnapshot && event.ts < this.lastReconnectTs) {
      return;
    }

    // ─── Hardening: duplicate event suppression ──────────────────
    // Build a unique event key from type + runId + toolCallId + ts.
    // If we've seen this exact event before, skip it.
    const eventKey = this.makeEventKey(event);
    if (eventKey) {
      if (this.seenEventIds.has(eventKey)) {
        return; // duplicate — suppress
      }
      this.seenEventIds.add(eventKey);
      // Prevent unbounded growth — trim oldest entries
      if (this.seenEventIds.size > this.maxSeenEvents) {
        const first = this.seenEventIds.values().next().value;
        if (first) this.seenEventIds.delete(first);
      }
    }

    // ─── Hardening: event ordering protection ────────────────────
    // Reject events with timestamps older than the last processed event.
    // This prevents out-of-order delivery from corrupting state.
    // Exception: command_start always resets the ordering baseline
    // because a new run may have a lower ts than a late event from
    // the previous run (clock skew between server processes).
    if (this.enforceOrdering && event.type !== "command_start") {
      if (event.ts < this.lastEventTs) {
        return; // out-of-order — reject
      }
    }
    this.lastEventTs = Math.max(this.lastEventTs, event.ts);

    const lifecycle = this.mapRuntimeEventToLifecycle(event);
    if (lifecycle) {
      this.notifyLifecycleListeners(lifecycle);
    }
  }

  /**
   * Build a unique key for duplicate detection.
   * Returns null for events that can't be deduplicated.
   */
  private makeEventKey(event: RuntimeEvent): string | null {
    if (!event.runId) return null;
    // tool_stream events can legitimately repeat with the same ts
    // (multiple chunks at the same millisecond), so include the
    // chunk text in the key for stream events.
    if (event.type === "tool_stream") {
      const chunk = (event.data?.chunk as string) ?? "";
      const stream = (event.data?.stream as string) ?? "";
      return `${event.type}:${event.runId}:${event.toolCallId ?? ""}:${event.ts}:${stream}:${chunk.length}`;
    }
    return `${event.type}:${event.runId}:${event.toolCallId ?? ""}:${event.ts}`;
  }

  private mapRuntimeEventToLifecycle(event: RuntimeEvent): LifecycleEvent | null {
    const runId = event.runId ?? this.currentRunId ?? "";
    const toolCallId = event.toolCallId;
    const ts = event.ts;
    const data = event.data;

    switch (event.type) {
      case "command_start":
        // Track the previous run as "old" so its late events get rejected
        if (this.currentRunId && this.currentRunId !== runId) {
          this.knownOldRuns.add(this.currentRunId);
        }
        this.currentRunId = runId;
        return { type: "run.started", runId, ts, data };

      case "command_end": {
        const success = data.success as boolean;
        const exitCode = data.exitCode as number | null;
        const cancelled = data.cancelled as boolean;
        const timedOut = data.timedOut as boolean;

        if (cancelled) {
          return { type: "run.completed", runId, ts, data: { ...data, status: "cancelled" } };
        }
        if (timedOut) {
          return { type: "run.completed", runId, ts, data: { ...data, status: "timeout" } };
        }
        return {
          type: "run.completed",
          runId,
          ts,
          data: { ...data, status: success ? "success" : "failed" },
        };
      }

      case "tool_call":
        return { type: "tool.started", runId, toolCallId, ts, data };

      case "tool_result": {
        const status = data.status as string;
        const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
        switch (status) {
          case "success":
            return { type: "tool.completed", runId, toolCallId: toolCallIdFromData, ts, data };
          case "failed":
            return { type: "tool.failed", runId, toolCallId: toolCallIdFromData, ts, data };
          case "cancelled":
            return { type: "tool.cancelled", runId, toolCallId: toolCallIdFromData, ts, data };
          case "timeout":
            return { type: "tool.timeout", runId, toolCallId: toolCallIdFromData, ts, data };
          default:
            return { type: "tool.completed", runId, toolCallId: toolCallIdFromData, ts, data };
        }
      }

      case "tool_stream": {
        const stream = data.stream as string;
        if (stream === "stdout") {
          return { type: "tool.stdout", runId, toolCallId, ts, data };
        }
        if (stream === "stderr") {
          return { type: "tool.stderr", runId, toolCallId, ts, data };
        }
        return null;
      }

      case "phase_change": {
        // Phase changes are state transitions, not lifecycle events per se.
        // But "running" → run.started and "complete"/"failed" → run.completed
        // are already handled by command_start/command_end.
        // Don't duplicate — return null.
        return null;
      }

      default:
        return null;
    }
  }

  // ─── REST fallback ─────────────────────────────────────────────

  /**
   * Dispatch a command via REST (POST /internal/command).
   * Used as fallback when Socket.IO is not connected, or as the primary
   * dispatch method (Socket.IO is for events, REST is for commands).
   */
  async dispatchCommand(
    command: string,
    args?: Record<string, unknown>,
    cwd?: string,
  ): Promise<{ ok: boolean; runId: string; result: unknown }> {
    if (this.internalKey.length < 32) {
      throw new Error(
        "TERMINAL_INTERNAL_SERVICE_KEY not configured (min 32 chars).",
      );
    }

    const response = await fetch(`${this.terminalUrl}/internal/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": this.internalKey,
      },
      body: JSON.stringify({
        command,
        args,
        cwd: cwd ?? process.cwd(),
      }),
      signal: AbortSignal.timeout(240_000),
    });

    const payload = await response.json().catch(() => null) as
      | { ok: boolean; runId: string; result: unknown; error?: string }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? `Remote command failed (${response.status})`);
    }
    if (!payload) {
      throw new Error("No response from terminal server");
    }

    // Track the runId for event correlation
    this.currentRunId = payload.runId;

    return payload;
  }

  /**
   * Cancel the currently active run.
   * Uses POST /internal/cancel if available, otherwise tries to abort
   * via the REST dispatch with a cancel command.
   */
  async cancelActiveRun(): Promise<boolean> {
    if (!this.currentRunId) return false;

    try {
      const response = await fetch(`${this.terminalUrl}/internal/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Key": this.internalKey,
        },
        body: JSON.stringify({ runId: this.currentRunId }),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the current runtime state via REST.
   * Used when Socket.IO is not connected or for initial state.
   */
  async fetchState(): Promise<RuntimeState | null> {
    try {
      const response = await fetch(`${this.terminalUrl}/internal/runtime`, {
        headers: { "X-Internal-Service-Key": this.internalKey },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.emitRuntimeError("FALLBACK_POLL_FAILED", `Fallback poll failed — server returned ${response.status}`);
        return null;
      }
      const state = await response.json() as RuntimeState;
      this.state = state;
      this.notifyStateListeners();
      return state;
    } catch (err) {
      this.emitRuntimeError(
        "FALLBACK_POLL_FAILED",
        `Fallback poll failed — ${err instanceof Error ? err.message : "server unreachable"}`,
      );
      return null;
    }
  }

  // ─── Reconnect / resync ────────────────────────────────────────

  /**
   * Force a reconnect and resync.
   * Called when the terminal-server restarts or when the client
   * detects that its state may be stale.
   *
   * This clears all local run tracking and duplicate-suppression state
   * so that the post-reconnect snapshot becomes the single source of truth.
   * No locally invented runtime state survives the resync.
   */
  async resync(): Promise<void> {
    // Mark the current run as old so any late events from it are rejected
    if (this.currentRunId) {
      this.knownOldRuns.add(this.currentRunId);
    }

    // Clear duplicate-suppression and ordering state — we're starting fresh
    this.seenEventIds.clear();
    this.lastEventTs = 0;
    this.awaitingSnapshot = true;
    this.lastReconnectTs = Date.now();

    if (this.socket) {
      this.socket.disconnect();
    }
    // Wait a moment for cleanup
    await new Promise((r) => setTimeout(r, 200));
    this.reconnectAttempts = 0;
    this.backoffMs = 1000; // reset backoff
    await this.connect();
    // Fetch fresh state via REST as a backup to the Socket.IO snapshot.
    // This is the authoritative resync — no locally invented state.
    await this.fetchState();
  }

  // ─── Public accessors ──────────────────────────────────────────

  getState(): RuntimeState | null {
    return this.state;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  is_connected(): boolean {
    return this.connectionState === "connected";
  }

  hasActiveRun(): boolean {
    return this.state?.activeCommand != null;
  }

  // ─── Hardening: introspection (for testing and debugging) ──────

  /** True if waiting for a post-reconnect snapshot */
  isAwaitingSnapshot(): boolean {
    return this.awaitingSnapshot;
  }

  /** Number of duplicate events suppressed */
  getSeenEventCount(): number {
    return this.seenEventIds.size;
  }

  /** Current backoff delay (ms) */
  getBackoffMs(): number {
    return this.backoffMs;
  }

  /** Known old runs (for testing stale-run filtering) */
  getKnownOldRuns(): string[] {
    return [...this.knownOldRuns];
  }

  /**
   * Reconcile local state with server state after reconnect.
   * If the server says idle but we think a run is active, the run
   * was lost during disconnect — mark it as old and clear local tracking.
   * If the server says a run is active, adopt it.
   */
  reconcile(serverState: RuntimeState): void {
    if (serverState.activeCommand == null && this.currentRunId) {
      // Server says idle, we think running — server wins
      this.knownOldRuns.add(this.currentRunId);
      this.currentRunId = null;
    }
    if (serverState.activeCommand?.runId) {
      // Server says a run is active — adopt it
      this.currentRunId = serverState.activeCommand.runId;
      // Clear any old-run marking for this run
      this.knownOldRuns.delete(serverState.activeCommand.runId);
    }
    this.state = serverState;
    this.notifyStateListeners();
  }

  // ─── Listener management ───────────────────────────────────────

  onLifecycle(listener: LifecycleListener): () => void {
    this.listeners.lifecycle.add(listener);
    return () => this.listeners.lifecycle.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.listeners.state.add(listener);
    return () => this.listeners.state.delete(listener);
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.listeners.connection.add(listener);
    return () => this.listeners.connection.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.listeners.error.add(listener);
    return () => this.listeners.error.delete(listener);
  }

  private notifyLifecycleListeners(event: LifecycleEvent): void {
    for (const listener of this.listeners.lifecycle) {
      try { listener(event); } catch { /* listener errors don't crash the client */ }
    }
  }

  private notifyStateListeners(): void {
    if (!this.state) return;
    for (const listener of this.listeners.state) {
      try { listener(this.state); } catch { /* listener errors don't crash the client */ }
    }
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    for (const listener of this.listeners.connection) {
      try { listener(state); } catch { /* listener errors don't crash the client */ }
    }
  }

  /**
   * Emit a typed runtime error. NEVER use Node EventEmitter's 'error' event —
   * Node crashes the process if 'error' is emitted with no listener.
   * This method uses a custom 'runtime.error' channel instead.
   */
  private emitRuntimeError(code: string, message: string): void {
    const error = { code, message };
    for (const listener of this.listeners.error) {
      try { listener(error); } catch { /* listener errors don't crash the client */ }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.setConnectionState("disconnected");
  }
}
