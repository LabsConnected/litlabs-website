/**
 * Runtime state and event system.
 *
 * One canonical runtime truth. PowerShell and web will eventually
 * consume this same state instead of maintaining their own.
 *
 * Phase 2C: Added heartbeat, active command, last result, timestamps,
 * serialization (toJSON), and heartbeat lifecycle management.
 *
 * Phase 3: MissionStore persistence integration.
 * Mission state persists to disk and restores on restart.
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
  Mission,
  MissionEventSubtype,
} from "./types.js";
import type { MissionStatus } from "./missions/mission-types.js";
import { MissionStore } from "./missions/mission-store.js";

// ─── Persistence Adapter ───────────────────────────────────────────────

/**
 * Interface for mission persistence.
 * Filesystem-based by default; DB adapters can be added later.
 */
export interface MissionPersistence {
  /** Load the active mission, if any */
  loadActiveMission(): Promise<Mission | null>;
  /** Save a mission */
  saveMission(mission: Mission): Promise<void>;
  /** Delete a mission */
  deleteMission(id: string): Promise<boolean>;
}

/**
 * Default filesystem-based mission persistence.
 * Uses MissionStore for the actual file I/O.
 */
export class FilesystemMissionPersistence implements MissionPersistence {
  private store: MissionStore;

  constructor(projectRoot: string) {
    this.store = new MissionStore(projectRoot);
  }

  async loadActiveMission(): Promise<Mission | null> {
    const activeId = this.store.getActiveMissionId();
    if (!activeId) return null;
    return this.store.getMission(activeId);
  }

  async saveMission(mission: Mission): Promise<void> {
    this.store.updateMission(mission);
  }

  async deleteMission(id: string): Promise<boolean> {
    return this.store.deleteMission(id);
  }
}

export function createFilesystemMissionPersistence(
  projectRoot: string,
): FilesystemMissionPersistence {
  return new FilesystemMissionPersistence(projectRoot);
}

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
    // Phase 3: Mission state for autonomous operation
    mission: null,
    lastMissionHeartbeatAt: 0,
    missionStepsCompleted: 0,
  };
}

// ─── RuntimeStore ─────────────────────────────────────────────────────

/**
 * RuntimeStore options.
 */
export interface RuntimeStoreOptions {
  /** Event emitter for runtime events */
  emitter?: RuntimeEventEmitter | null;
  /** Project root for persistence (enables MissionStore persistence) */
  projectRoot?: string;
  /** Custom persistence adapter (defaults to FilesystemMissionPersistence) */
  persistence?: MissionPersistence | null;
}

export class RuntimeStore {
  private state: RuntimeState;
  private emitter: RuntimeEventEmitter | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null;
  private heartbeatFn: (() => Promise<number>) | null;
  private _persistence: MissionPersistence | null;

  constructor(
    emitterOrOptions?: RuntimeEventEmitter | RuntimeStoreOptions,
  ) {
    this.state = createInitialState();
    // Handle overloaded constructor
    if (typeof emitterOrOptions === "function" || emitterOrOptions === undefined) {
      this.emitter = emitterOrOptions ?? null;
      this._persistence = null;
    } else {
      this.emitter = emitterOrOptions.emitter ?? null;
      this._persistence = this.createPersistence(emitterOrOptions);
    }
    this.heartbeatTimer = null;
    this.heartbeatFn = null;
  }

  /**
   * Create the persistence adapter based on options.
   */
  private createPersistence(opts: RuntimeStoreOptions): MissionPersistence | null {
    if (opts.persistence) return opts.persistence;
    if (opts.projectRoot) {
      return createFilesystemMissionPersistence(opts.projectRoot);
    }
    return null;
  }

  // ── State access ────────────────────────────────────────────────

  getState(): RuntimeState {
    return { ...this.state };
  }

  /**
   * Set or replace the event emitter.
   * Useful for wiring the store to Socket.IO after construction.
   */
  setEmitter(emitter: RuntimeEventEmitter | null): void {
    this.emitter = emitter;
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

  // ── Persistence Lifecycle ────────────────────────────────────────

  /**
   * Load mission state from persistence.
   * Call this on startup after setting project context.
   * Restores the active mission and its status from disk.
   */
  async load(): Promise<void> {
    if (!this._persistence) return;

    const savedMission = await this._persistence.loadActiveMission();
    if (savedMission) {
      // Restore the mission state
      this.state.mission = savedMission;
      this.state.lastMissionHeartbeatAt = savedMission.lastHeartbeatAt;
      this.state.missionStepsCompleted = savedMission.steps.filter(
        (s) => s.status === "passed" || s.status === "skipped",
      ).length;
      this.touch();
      this.emit({
        type: "litt_event",
        subtype: "mission:restored",
        ts: Date.now(),
        data: { missionId: savedMission.id, status: savedMission.status },
      });
    }
  }

  /**
   * Persist the current mission state.
   */
  private async persistMission(): Promise<void> {
    if (!this._persistence || !this.state.mission) return;

    try {
      await this._persistence.saveMission(this.state.mission);
    } catch {
      // Silent fail - persistence errors shouldn't break runtime
    }
  }

  /**
   * Check if persistence is enabled.
   */
  isPersistenceEnabled(): boolean {
    return this._persistence !== null;
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

  // ── Mission ────────────────────────────────────────────────────────

  /**
   * Set the active mission.
   * Emits mission:created or mission:started event.
   */
  setMission(mission: Mission): void {
    const hadMission = this.state.mission !== null;
    this.state.mission = mission;
    this.state.lastMissionHeartbeatAt = Date.now();
    this.touch();
    if (!hadMission) {
      this.emit({
        type: "litt_event",
        subtype: "mission:created",
        ts: Date.now(),
        data: { missionId: mission.id, mode: mission.mode },
      });
    } else if (mission.status !== "planning") {
      this.emit({
        type: "litt_event",
        subtype: "mission:started",
        ts: Date.now(),
        data: { missionId: mission.id, status: mission.status },
      });
    }
  }

  /**
   * Update mission status.
   * Emits appropriate mission event subtype.
   */
  updateMissionStatus(missionId: string, status: MissionStatus): void {
    const mission = this.state.mission;
    if (!mission || mission.id !== missionId) return;
    const prevStatus = mission.status;
    if (prevStatus === status) return;

    mission.status = status;
    this.state.updatedAt = Date.now();
    this.touch();

    this.emit({
      type: "litt_event",
      subtype: `mission:${status}` as MissionEventSubtype,
      ts: Date.now(),
      data: { missionId, from: prevStatus, to: status },
    });
  }

  /**
   * Update mission step count.
   */
  incrementMissionStepsCompleted(): void {
    this.state.missionStepsCompleted++;
    this.touch();
  }

  /**
   * Send mission heartbeat.
   */
  emitMissionHeartbeat(): void {
    const mission = this.state.mission;
    if (mission) {
      this.state.lastMissionHeartbeatAt = Date.now();
      this.touch();
      this.emit({
        type: "litt_event",
        subtype: "mission:heartbeat",
        ts: Date.now(),
        data: { missionId: mission.id, stepsCompleted: this.state.missionStepsCompleted },
      });
    }
  }

  /**
   * Clear mission (e.g. on cancellation or completion).
   */
  clearMission(missionId: string): void {
    const mission = this.state.mission;
    if (mission?.id !== missionId) return;
    this.state.mission = null;
    this.state.lastMissionHeartbeatAt = 0;
    this.state.missionStepsCompleted = 0;
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
   * The runId is the shared identity across CLI, Studio, and Socket.IO.
   */
  commandStart(command: string, args: string[], cwd: string, runId?: string): void {
    const id = runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const active: ActiveCommand = {
      command,
      args,
      startedAt: Date.now(),
      cwd,
      runId: id,
    };
    this.state.activeCommand = active;
    this.setPhase("running");
    this.emit({
      type: "command_start",
      ts: active.startedAt,
      data: { command, args, cwd, runId: id },
    });
  }

  /**
   * Mark a command as finished. Emits command_end.
   * Stores the result for both surfaces to display.
   * Carries the runId from the active command for bidirectional identity.
   */
  commandEnd(
    command: string,
    success: boolean,
    exitCode: number | null,
    durationMs: number,
    message: string,
    runId?: string,
  ): void {
    const finishedAt = Date.now();
    const id = runId ?? this.state.activeCommand?.runId ?? `run_${finishedAt}_${Math.random().toString(36).slice(2, 8)}`;
    const result: LastResult = {
      command,
      success,
      exitCode,
      durationMs,
      finishedAt,
      message,
      runId: id,
    };
    this.state.lastResult = result;
    this.state.activeCommand = null;
    this.setPhase(success ? "complete" : "failed");
    this.emit({
      type: "command_end",
      ts: finishedAt,
      data: { command, success, exitCode, durationMs, message, runId: id },
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
