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
import type { MissionStatus, MissionStepStatus, MissionEvidence, EvidenceType } from "./missions/mission-types.js";
import type { MissionStep } from "./missions/mission-entities.js";
import { MissionStore } from "./missions/mission-store.js";
import { generateStepId, generateEvidenceId } from "./missions/mission-types.js";
import { validateStepTransition, isValidMissionTransition } from "./missions/mission-state-machine.js";

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
  /** Get active mission ID, if any */
  getActiveMissionId(): string | null;
  /** Clear the active mission marker */
  clearActiveMission(): void | Promise<void>;
  /** Load active mission with recovery support */
  loadActiveMissionWithRecovery(): Promise<RecoveryResult> | RecoveryResult;
}

/**
 * Recovery result from loading a mission.
 */
export interface RecoveryResult {
  recovered: boolean;
  error?: { reason: string; message?: string };
  resumedFrom?: string;
  mission: Mission | null;
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
    this.store.setActiveMission(mission.id);
  }

  async deleteMission(id: string): Promise<boolean> {
    return this.store.deleteMission(id);
  }

  getActiveMissionId(): string | null {
    return this.store.getActiveMissionId();
  }

  clearActiveMission(): void {
    this.store.clearActiveMission();
  }

  loadActiveMissionWithRecovery(): RecoveryResult {
    const activeId = this.store.getActiveMissionId();
    if (!activeId) {
      return { recovered: false, mission: null, error: { reason: "missing" } };
    }

    const result = this.store.loadMissionWithRecovery(activeId);

    // Check if mission was created by resumeFromCheckpoint (has resumedFrom in metadata)
    const resumedFrom = result.recovered?.metadata?.resumedFrom as string | undefined;

    // Determine if this is a fresh load or recovery
    // recovered = true means we got a valid mission back (possibly from backup recovery)
    const recovered = result.recovered !== null;

    return {
      recovered,
      mission: result.recovered,
      error: result.error,
      resumedFrom,
    };
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
  // ReturnType<typeof setInterval> resolves to NodeJS.Timeout under
  // @types/node and to number under DOM lib. Support both so the file
  // type-checks identically in Node-only and mixed lib environments.
  private heartbeatTimer: ReturnType<typeof setInterval> | null;
  private heartbeatFn: (() => Promise<number>) | null;
  private _persistence: MissionPersistence | null;

  constructor(
    emitterOrOptions?: RuntimeEventEmitter | RuntimeStoreOptions,
  ) {
    this.state = createInitialState();
    // Handle overloaded constructor
    if (typeof emitterOrOptions === "function") {
      this.emitter = emitterOrOptions;
      this._persistence = null;
    } else if (emitterOrOptions === undefined) {
      this.emitter = null;
      this._persistence = null;
    } else {
      this.emitter = emitterOrOptions.emitter ?? null;
      this._persistence = this.createPersistence(emitterOrOptions);
    }
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
   * Public persistence hook for callers that mutate mission step fields
   * directly (e.g. the semantic mission planner attaching tool calls to
   * existing steps via toolHistory/actionHistory). Touches state, emits
   * nothing extra, and persists.
   *
   * This does NOT change mission/step status — use the dedicated
   * transition methods for that. It only persists in-place mutations
   * to step arrays (toolHistory, actionHistory, filesRead, filesChanged).
   */
  async persistMissionNow(): Promise<void> {
    if (!this.state.mission) return;
    this.touch();
    await this.persistMission();
  }

  /**
   * Check if persistence is enabled.
   */
  isPersistenceEnabled(): boolean {
    return this._persistence !== null;
  }

  /**
   * Get the persistence adapter instance.
   */
  getPersistence(): MissionPersistence | null {
    return this._persistence;
  }

  /**
   * Load mission state with recovery support.
   * Returns the recovery result with mission set in state if loaded.
   */
  async loadWithRecovery(): Promise<RecoveryResult> {
    if (!this._persistence) {
      return { recovered: false, mission: null, error: { reason: "missing" } };
    }

    const result = await this._persistence.loadActiveMissionWithRecovery();

    if (result.mission) {
      this.state.mission = result.mission;
      this.state.lastMissionHeartbeatAt = result.mission.lastHeartbeatAt;
      this.state.missionStepsCompleted = result.mission.steps.filter(
        (s) => s.status === "passed" || s.status === "skipped",
      ).length;
      this.touch();
      this.emit({
        type: "litt_event",
        subtype: "mission:restored",
        ts: Date.now(),
        data: { missionId: result.mission.id, status: result.mission.status },
      });
    }

    return result;
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
   * Create a new mission and set it as the canonical active mission.
   * This is the ONE entry point for starting a new mission — the
   * controller calls this when natural-language input is classified
   * as a mission. The mission is persisted through the existing
   * FilesystemMissionPersistence / MissionStore path.
   *
   * Returns the created Mission (now the canonical RuntimeStore.mission).
   */
  async createMission(params: {
    goal: string;
    mode?: "plan" | "act" | "auto";
    projectRoot?: string;
    sessionId?: string | null;
    workspaceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<Mission> {
    const mission: Mission = {
      id: `mission_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      version: "1.0.0",
      goal: params.goal,
      normalizedGoal: params.goal.trim().toLowerCase(),
      projectRoot: params.projectRoot ?? "",
      workspaceId: params.workspaceId ?? null,
      sessionId: params.sessionId ?? null,
      mode: params.mode ?? "act",
      status: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      currentStepId: null,
      steps: [],
      baseline: null,
      evidence: [],
      checkpoints: [],
      attemptCounters: {},
      retryBudgets: {},
      providerState: null,
      blockingReason: null,
      failureReason: null,
      completionReason: null,
      lastHeartbeatAt: Date.now(),
      metadata: params.metadata ?? {},
    };

    // Use the existing setMission path — it emits mission:created
    // and persists through the canonical adapter.
    await this.setMission(mission);
    return mission;
  }

  /**
   * Set the active mission.
   * Persists the mission and emits mission:created or mission:started event.
   *
   * State mutation and event emission happen synchronously (before the
   * await), so callers that don't await still see the state change
   * immediately. Callers that DO await get the guarantee that the
   * mission has been persisted to disk before continuing.
   */
  async setMission(mission: Mission): Promise<void> {
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
    // Persist the mission to disk (awaited so callers can rely on it)
    await this.persistMission();
  }

  /**
   * Update mission status.
   * Emits appropriate mission event subtype and persists the change.
   *
   * State mutation and event emission happen synchronously (before the
   * await), so callers that don't await still see the state change
   * immediately. Callers that DO await get the guarantee that the
   * status change has been persisted before continuing.
   */
  async updateMissionStatus(missionId: string, status: MissionStatus): Promise<void> {
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

    // Persist the status change (awaited so callers can rely on it)
    await this.persistMission();
  }

  // ── Mission Steps ─────────────────────────────────────────────────

  /**
   * Add a step to the current mission.
   * The step is appended to mission.steps with status "pending".
   * Emits mission:step_created and persists.
   */
  async addMissionStep(params: {
    title: string;
    description?: string;
    requiredEvidence?: EvidenceType[];
    dependencies?: string[];
    allowedActionScope?: string[];
  }): Promise<MissionStep | null> {
    const mission = this.state.mission;
    if (!mission) return null;

    const stepId = generateStepId();
    const newStep: MissionStep = {
      id: stepId,
      sequence: mission.steps.length,
      title: params.title,
      description: params.description ?? "",
      status: "pending",
      requiredEvidence: params.requiredEvidence ?? [],
      dependencies: params.dependencies ?? [],
      allowedActionScope: params.allowedActionScope ?? [],
      toolHistory: [],
      actionHistory: [],
      filesRead: [],
      filesChanged: [],
      verificationResults: [],
      attemptCount: 0,
      repairAttemptCount: 0,
      failureReason: null,
      blockingReason: null,
      startedAt: null,
      finishedAt: null,
    };

    mission.steps.push(newStep);
    this.touch();
    this.emit({
      type: "litt_event",
      subtype: "mission:step_created",
      ts: Date.now(),
      data: { missionId: mission.id, stepId, title: newStep.title, sequence: newStep.sequence },
    });
    await this.persistMission();
    return newStep;
  }

  /**
   * Set the current step of the mission.
   * Emits mission:step_started if the step transitions to "working".
   */
  async setCurrentStep(stepId: string): Promise<void> {
    const mission = this.state.mission;
    if (!mission) return;
    const step = mission.steps.find((s) => s.id === stepId);
    if (!step) return;

    mission.currentStepId = stepId;

    // Transition step to "working" if it's pending
    if (step.status === "pending") {
      const validation = validateStepTransition(step.status, "working");
      if (validation.allowed) {
        step.status = "working";
        step.startedAt = new Date().toISOString();
        step.attemptCount++;
      }
    }

    // Transition mission to "working" if it's "planning"
    if (mission.status === "planning" && isValidMissionTransition("planning", "working")) {
      mission.status = "working";
      if (!mission.startedAt) {
        mission.startedAt = new Date().toISOString();
      }
    }

    this.touch();
    this.emit({
      type: "litt_event",
      subtype: "mission:step_started",
      ts: Date.now(),
      data: { missionId: mission.id, stepId, title: step.title, status: step.status },
    });
    await this.persistMission();
  }

  /**
   * Update a mission step's status.
   * Validates the transition using the canonical state machine.
   * Records verification results when provided.
   * Emits mission:step_{status} and persists.
   */
  async updateMissionStepStatus(
    stepId: string,
    status: MissionStepStatus,
    options?: {
      failureReason?: string;
      blockingReason?: string;
      verificationPassed?: boolean;
      verificationEvidence?: string;
    },
  ): Promise<void> {
    const mission = this.state.mission;
    if (!mission) return;
    const step = mission.steps.find((s) => s.id === stepId);
    if (!step) return;

    const validation = validateStepTransition(step.status, status);
    if (!validation.allowed) return;

    step.status = status;
    if (status === "passed" || status === "failed" || status === "skipped") {
      step.finishedAt = new Date().toISOString();
    }
    if (options?.failureReason) step.failureReason = options.failureReason;
    if (options?.blockingReason) step.blockingReason = options.blockingReason;
    if (options?.verificationPassed !== undefined) {
      step.verificationResults.push({
        checkId: `check_${Date.now()}`,
        passed: options.verificationPassed,
        evidence: options.verificationEvidence ?? "",
        timestamp: new Date().toISOString(),
      });
    }

    // Update mission-level state based on step outcome
    this.state.missionStepsCompleted = mission.steps.filter(
      (s) => s.status === "passed" || s.status === "skipped",
    ).length;

    this.touch();
    this.emit({
      type: "litt_event",
      subtype: `mission:step_${status}` as MissionEventSubtype,
      ts: Date.now(),
      data: {
        missionId: mission.id,
        stepId,
        title: step.title,
        from: step.status,
        to: status,
      },
    });
    await this.persistMission();
  }

  /**
   * Record evidence on the current mission (and optionally a specific step).
   * Emits mission:evidence_recorded and persists.
   */
  async addMissionEvidence(evidence: {
    stepId?: string | null;
    type: EvidenceType;
    source: string;
    summary: string;
    success?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<MissionEvidence | null> {
    const mission = this.state.mission;
    if (!mission) return null;

    const evidenceId = generateEvidenceId();
    const record: MissionEvidence = {
      id: evidenceId,
      missionId: mission.id,
      stepId: evidence.stepId ?? null,
      type: evidence.type,
      source: evidence.source,
      timestamp: new Date().toISOString(),
      success: evidence.success,
      summary: evidence.summary,
      metadata: evidence.metadata ?? {},
    };

    mission.evidence.push(record);
    this.touch();
    this.emit({
      type: "litt_event",
      subtype: "mission:evidence_recorded",
      ts: Date.now(),
      data: {
        missionId: mission.id,
        evidenceId,
        type: record.type,
        stepId: record.stepId,
        success: record.success,
        summary: record.summary.slice(0, 200),
      },
    });
    await this.persistMission();
    return record;
  }

  /**
   * Record a tool invocation on a mission step.
   * Updates step.toolHistory and step.actionHistory.
   * Does NOT change step status — that is driven by execution results.
   */
  async recordStepToolCall(
    stepId: string,
    tool: string,
    action: { description: string; status: "success" | "failed" | "approved" | "denied" },
  ): Promise<void> {
    const mission = this.state.mission;
    if (!mission) return;
    const step = mission.steps.find((s) => s.id === stepId);
    if (!step) return;

    if (!step.toolHistory.includes(tool)) {
      step.toolHistory.push(tool);
    }
    step.actionHistory.push({
      description: action.description,
      tool,
      timestamp: new Date().toISOString(),
      status: action.status,
    });
    this.touch();
    await this.persistMission();
  }

  /**
   * Get the current mission (canonical truth).
   * Returns null if no mission is active.
   */
  getMission(): Mission | null {
    return this.state.mission;
  }

  /**
   * Mark the mission as verifying (entering VerificationGate).
   * Transitions to "verifying" status if valid.
   */
  async setMissionVerifying(): Promise<void> {
    const mission = this.state.mission;
    if (!mission) return;
    if (!isValidMissionTransition(mission.status, "verifying")) return;
    mission.status = "verifying";
    this.touch();
    this.emit({
      type: "litt_event",
      subtype: "mission:verifying",
      ts: Date.now(),
      data: { missionId: mission.id },
    });
    await this.persistMission();
  }

  /**
   * Complete the mission with runtime-proven verification.
   * ONLY call this when VerificationGate.proven === true.
   * Records verification evidence and transitions to "complete".
   */
  async completeMission(completionReason: string, verificationEvidence?: string): Promise<void> {
    const mission = this.state.mission;
    if (!mission) return;
    if (!isValidMissionTransition(mission.status, "complete")) return;

    mission.status = "complete";
    mission.completionReason = completionReason;
    mission.completedAt = new Date().toISOString();

    if (verificationEvidence) {
      mission.evidence.push({
        id: generateEvidenceId(),
        missionId: mission.id,
        stepId: null,
        type: "verification_result",
        source: "VerificationGate",
        timestamp: new Date().toISOString(),
        success: true,
        summary: verificationEvidence,
        metadata: {},
      });
    }

    this.touch();
    this.emit({
      type: "litt_event",
      subtype: "mission:completed",
      ts: Date.now(),
      data: { missionId: mission.id, completionReason },
    });
    await this.persistMission();
  }

  /**
   * Fail the mission with a reason.
   * Records failure evidence and transitions to "failed".
   */
  async failMission(failureReason: string, verificationEvidence?: string): Promise<void> {
    const mission = this.state.mission;
    if (!mission) return;
    if (!isValidMissionTransition(mission.status, "failed")) {
      // From "verifying" we can go to "failed" via "working" first
      if (mission.status === "verifying" && isValidMissionTransition("verifying", "working")) {
        mission.status = "working";
      } else {
        return;
      }
    }

    mission.status = "failed";
    mission.failureReason = failureReason;
    mission.completedAt = new Date().toISOString();

    if (verificationEvidence) {
      mission.evidence.push({
        id: generateEvidenceId(),
        missionId: mission.id,
        stepId: null,
        type: "verification_result",
        source: "VerificationGate",
        timestamp: new Date().toISOString(),
        success: false,
        summary: verificationEvidence,
        metadata: {},
      });
    }

    this.touch();
    this.emit({
      type: "litt_event",
      subtype: "mission:failed",
      ts: Date.now(),
      data: { missionId: mission.id, failureReason },
    });
    await this.persistMission();
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
   * Deletes persisted mission and clears active state.
   */
  async clearMission(missionId: string): Promise<void> {
    const mission = this.state.mission;
    if (mission?.id !== missionId) return;

    // Delete from persistence
    if (this._persistence) {
      await this._persistence.deleteMission(missionId);
    }

    // Clear active mission marker
    if (this._persistence) {
      await this._persistence.clearActiveMission();
    }

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
    // Don't keep the process alive just for heartbeats.
    // `unref` is a Node-only API; guard for environments where the
    // timer is a number (DOM lib typing) or lacks unref.
    const timer = this.heartbeatTimer as { unref?: () => void } | null;
    if (timer && typeof timer.unref === "function") {
      timer.unref();
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
