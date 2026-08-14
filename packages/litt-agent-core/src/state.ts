/**
 * Runtime state and event system.
 *
 * One canonical runtime truth. PowerShell and web will eventually
 * consume this same state instead of maintaining their own.
 *
 * Phase 2C: Added heartbeat, active command, last result, timestamps,
 * serialization (toJSON), and heartbeat lifecycle management.
 */

import type {
  RuntimePhase,
  RuntimeState,
  RuntimeEvent,
  RuntimeEventEmitter,
  ProjectContext,
  HeartbeatStatus,
  ActiveCommand,
  LastResult,
} from "./types.js";

export function createInitialState(): RuntimeState {
  const now = Date.now();
  return {
    phase: "idle",
    project: null,
    branch: null,
    model: null,
    profile: null,
    gitChanges: 0,
    online: false,
    pingMs: -1,
    contextTokens: 0,
    heartbeat: {
      seq: 0,
      lastHeartbeatAt: 0,
      failures: 0,
      maxFailures: 3,
      intervalMs: 15_000,
      latencyMs: null,
    },
    activeCommand: null,
    lastResult: null,
    updatedAt: now,
  };
}

export class RuntimeStore {
  private state: RuntimeState;
  private emitter: RuntimeEventEmitter | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null;
  private heartbeatFn: (() => Promise<number>) | null;

  constructor(emitter?: RuntimeEventEmitter) {
    this.state = createInitialState();
    this.emitter = emitter ?? null;
    this.heartbeatTimer = null;
    this.heartbeatFn = null;
  }

  // ── State access ────────────────────────────────────────────────

  getState(): RuntimeState {
    return { ...this.state };
  }

  /**
   * Serialize state for Socket.IO transport.
   * This is the canonical shape both surfaces receive.
   */
  toJSON(): string {
    return JSON.stringify(this.state);
  }

  /**
   * Replace the entire state (e.g. from a deserialized snapshot).
   * Emits a state_sync event.
   */
  setState(state: RuntimeState): void {
    this.state = { ...state };
    this.touch();
    this.emit({
      type: "state_sync",
      ts: Date.now(),
      data: { state: this.state },
    });
  }

  // ── Phase ───────────────────────────────────────────────────────

  setPhase(phase: RuntimePhase): void {
    const prev = this.state.phase;
    this.state.phase = phase;
    this.touch();
    if (prev !== phase) {
      this.emit({
        type: "phase_change",
        ts: Date.now(),
        data: { from: prev, to: phase },
      });
    }
  }

  // ── Project ─────────────────────────────────────────────────────

  setProject(project: ProjectContext | null): void {
    this.state.project = project;
    this.state.branch = project?.branch ?? null;
    this.touch();
  }

  // ── Model ───────────────────────────────────────────────────────

  setModel(model: string | null, profile: string | null): void {
    this.state.model = model;
    this.state.profile = profile;
    this.touch();
  }

  // ── Git ─────────────────────────────────────────────────────────

  setGitChanges(count: number): void {
    this.state.gitChanges = count;
    this.touch();
  }

  // ── Network ─────────────────────────────────────────────────────

  setOnline(online: boolean, pingMs: number): void {
    this.state.online = online;
    this.state.pingMs = pingMs;
    this.touch();
  }

  // ── Context ─────────────────────────────────────────────────────

  setContextTokens(tokens: number): void {
    this.state.contextTokens = tokens;
    this.touch();
  }

  // ── Active command ──────────────────────────────────────────────

  /**
   * Mark a command as started. Emits command_start.
   * Both surfaces use this to show "running..." state.
   */
  commandStart(command: string, args: string[], cwd: string): void {
    const active: ActiveCommand = {
      command,
      args,
      startedAt: Date.now(),
      cwd,
    };
    this.state.activeCommand = active;
    this.setPhase("running");
    this.emit({
      type: "command_start",
      ts: active.startedAt,
      data: { command, args, cwd },
    });
  }

  /**
   * Mark a command as finished. Emits command_end.
   * Stores the result for both surfaces to display.
   */
  commandEnd(
    command: string,
    success: boolean,
    exitCode: number | null,
    durationMs: number,
    message: string,
  ): void {
    const finishedAt = Date.now();
    const result: LastResult = {
      command,
      success,
      exitCode,
      durationMs,
      finishedAt,
      message,
    };
    this.state.lastResult = result;
    this.state.activeCommand = null;
    this.setPhase(success ? "complete" : "failed");
    this.emit({
      type: "command_end",
      ts: finishedAt,
      data: { command, success, exitCode, durationMs, message },
    });
  }

  // ── Heartbeat ───────────────────────────────────────────────────

  /**
   * Configure heartbeat parameters.
   */
  configureHeartbeat(opts: {
    intervalMs?: number;
    maxFailures?: number;
  }): void {
    if (opts.intervalMs !== undefined) {
      this.state.heartbeat.intervalMs = opts.intervalMs;
    }
    if (opts.maxFailures !== undefined) {
      this.state.heartbeat.maxFailures = opts.maxFailures;
    }
    this.touch();
  }

  /**
   * Set the heartbeat probe function.
   * The function should return latency in ms, or throw on failure.
   */
  setHeartbeatProbe(fn: () => Promise<number>): void {
    this.heartbeatFn = fn;
  }

  /**
   * Start the heartbeat interval. Requires a probe function to be set.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    if (!this.heartbeatFn) {
      throw new Error("Heartbeat probe not set. Call setHeartbeatProbe() first.");
    }
    const intervalMs = this.state.heartbeat.intervalMs;
    this.heartbeatTimer = setInterval(() => {
      this.tickHeartbeat().catch(() => {
        // Errors are handled inside tickHeartbeat
      });
    }, intervalMs);
    // Don't keep the process alive just for heartbeats
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Stop the heartbeat interval.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Perform a single heartbeat tick.
   * Calls the probe function, updates status, and emits a heartbeat event.
   */
  async tickHeartbeat(): Promise<void> {
    if (!this.heartbeatFn) return;

    const hb = this.state.heartbeat;
    const seq = hb.seq + 1;
    const t0 = Date.now();

    try {
      const latencyMs = await this.heartbeatFn();
      this.state.heartbeat = {
        ...hb,
        seq,
        lastHeartbeatAt: Date.now(),
        failures: 0,
        latencyMs,
      };
      this.state.online = true;
      this.state.pingMs = latencyMs;
      this.touch();
      this.emit({
        type: "heartbeat",
        ts: this.state.heartbeat.lastHeartbeatAt,
        data: {
          seq,
          success: true,
          latencyMs,
          failures: 0,
        },
      });
    } catch (err) {
      const failures = hb.failures + 1;
      this.state.heartbeat = {
        ...hb,
        seq,
        failures,
        latencyMs: null,
      };
      // Only go offline if we've exceeded the failure threshold
      if (failures >= hb.maxFailures) {
        this.state.online = false;
      }
      this.touch();
      this.emit({
        type: "heartbeat",
        ts: Date.now(),
        data: {
          seq,
          success: false,
          failures,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  /**
   * Returns true if the heartbeat is stale (last heartbeat too old).
   */
  isStale(maxAgeMs: number = 60_000): boolean {
    const hb = this.state.heartbeat;
    if (hb.lastHeartbeatAt === 0) return true;
    return Date.now() - hb.lastHeartbeatAt > maxAgeMs;
  }

  // ── Internal ────────────────────────────────────────────────────

  private touch(): void {
    this.state.updatedAt = Date.now();
  }

  private emit(event: RuntimeEvent): void {
    if (this.emitter) {
      try {
        this.emitter(event);
      } catch {
        // emitter must never crash the runtime
      }
    }
  }
}
