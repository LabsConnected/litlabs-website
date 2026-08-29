/**
 * WorkstreamStore — canonical, framework-agnostic "watch LiTT work" state.
 *
 * PURPOSE
 *   The interactive TUI should feel ALIVE while LiTT works: the operator
 *   watches WHAT it is inspecting, WHAT it concluded, which file it is
 *   changing (+/- counts, expandable diff), which tool/command/test it is
 *   running, verification results, and failures/retries. This store is the
 *   single canonical projection of that live workstream.
 *
 * NO CHAIN-OF-THOUGHT
 *   A `reason` activity carries ONLY a concise, user-facing CONCLUSION
 *   (e.g. "Found the viewport budget mismatch."). It must NEVER contain
 *   hidden scratchpad/reasoning tokens. The caller decides what is safe to
 *   surface; the store only enforces shape and ordering.
 *
 * ARCHITECTURE
 *   Mirrors the ChatTranscriptStore / ToolProgressStore pattern: a pure,
 *   renderer-free class that the CockpitStore hook owns, mirrors its
 *   snapshot into React state, and whose invariants are unit-tested in the
 *   CLI `node` env without a renderer.
 *
 * INVARIANTS (enforced here, covered by workstream.test.ts)
 *   1. Activities are append-only, ordered by insertion (time).
 *   2. begin() creates a running record; complete/fail terminalize it.
 *   3. complete/fail only update a RUNNING activity (no-op on terminal).
 *   4. edit records carry added/removed counts and an optional unified diff.
 *   5. retry records link to a parent via retriesOf and carry a concise reason.
 *   6. The store is bounded to MAX_ACTIVITIES (oldest dropped).
 *   7. Each activity knows its phase (INSPECTING / EDITING / TESTING / …).
 *   8. clear() resets everything (new session / Ctrl+L).
 *   9. objective/nextAction are optional single-string fields; setting them
 *      replaces the previous value (no history accumulation).
 *  10. verification is a structured sub-state with checks array.
 *  11. overallStatus tracks the workstream lifecycle:
 *      idle → running → (complete | failed | blocked).
 */

export const MAX_ACTIVITIES = 120;

/** The activity vocabulary — what LiTT observably does. */
export type WorkstreamKind =
  | "inspect"   // file/path being examined
  | "reason"    // concise user-facing conclusion (NO chain-of-thought)
  | "edit"      // file mutation with +/- counts + optional unified diff
  | "tool"      // tool run (friendly label + elapsed + success)
  | "command"   // shell command run
  | "test"      // test suite with passed/failed/skipped counts
  | "verify"    // final gate: typecheck / build / git / deploy
  | "warning"   // non-fatal caution
  | "retry"     // a failed operation was retried (links to parent)
  | "failure"   // a failed operation (remains visible)
  | "success";  // a completed phase / overall success

export type WorkstreamStatus = "running" | "complete" | "failed";

/** The overall workstream lifecycle status. */
export type WorkstreamOverallStatus =
  | "idle"
  | "running"
  | "blocked"
  | "complete"
  | "failed";

/** Standardized phase vocabulary for the active-state header. */
export type WorkstreamPhase =
  | "understanding"
  | "inspecting"
  | "planning"
  | "editing"
  | "running"
  | "testing"
  | "verifying"
  | "deploying"
  | "syncing"
  | "complete"
  | "blocked"
  | "failed";

/** Human phase labels driven by the live activity stream. */
export const PHASE_LABELS = {
  inspect: "INSPECTING",
  reason: "WORKING",
  edit: "EDITING",
  tool: "EXECUTING",
  command: "EXECUTING",
  test: "TESTING",
  verify: "VERIFYING",
  warning: "WORKING",
  retry: "RETRYING",
  failure: "FAILED",
  success: "COMPLETE",
} as const;

/** Display labels for the standardized phase vocabulary. */
export const PHASE_DISPLAY: Record<WorkstreamPhase, string> = {
  understanding: "UNDERSTANDING",
  inspecting: "INSPECTING",
  planning: "PLANNING",
  editing: "EDITING",
  running: "RUNNING",
  testing: "TESTING",
  verifying: "VERIFYING",
  deploying: "DEPLOYING",
  syncing: "SYNCING",
  complete: "COMPLETE",
  blocked: "BLOCKED",
  failed: "FAILED",
};

/** A single verification check within the verification sub-state. */
export interface VerificationCheck {
  /** Stable id. */
  id: string;
  /** Human-readable label (e.g. "TypeScript", "Workstream tests"). */
  label: string;
  status: "pending" | "running" | "passed" | "failed";
  /** Optional detail (e.g. "2141 passed · 4 skipped"). */
  detail?: string;
}

/** Structured verification sub-state. */
export interface VerificationState {
  status: "pending" | "running" | "passed" | "failed";
  checks: VerificationCheck[];
}

export interface WorkstreamActivity {
  /** Stable id. */
  id: string;
  kind: WorkstreamKind;
  status: WorkstreamStatus;
  /** Epoch ms. */
  ts: number;
  /** Phase this belongs to (drives status-area + group headers). */
  phase: string;
  /** Concise user-facing text. NEVER chain-of-thought. */
  label: string;
  /** Optional subject: file path, tool id, command, test file. */
  subject?: string;

  // ── edit ──
  added?: number;
  removed?: number;
  /** Unified diff lines (one string per line) for the expandable view. */
  diff?: string[];

  // ── tool / command ──
  command?: string;
  elapsedMs?: number | null;
  success?: boolean;

  // ── test ──
  passed?: number;
  failed?: number;
  skipped?: number;

  // ── retry ──
  /** Parent activity id this retried. */
  retriesOf?: string;
  /** Concise reason for the retry. */
  reason?: string;

  /** Whether the activity's diff/details are expanded. */
  expanded?: boolean;
}

export interface WorkstreamSnapshot {
  /** Ordered activities. */
  activities: WorkstreamActivity[];
  /** The current phase (latest activity's phase, or "IDLE"). */
  currentPhase: string;
  /** True when any activity is still running. */
  hasRunning: boolean;
  /** The overall workstream lifecycle status. */
  overallStatus: WorkstreamOverallStatus;
  /** One-sentence description of what LiTT is trying to accomplish. */
  objective: string | null;
  /** Standardized phase (drives the active-state header badge). */
  phase: WorkstreamPhase | null;
  /** What LiTT expects to do after the current step (null = unknown). */
  nextAction: string | null;
  /** Structured verification sub-state (null when no verification running). */
  verification: VerificationState | null;
  /** Count of activities hidden from the visible window (for "↑ N earlier"). */
  hiddenCount: number;
}

let idCounter = 0;

function nextId(): string {
  return `ws_${Date.now().toString(36)}_${++idCounter}`;
}

export class WorkstreamStore {
  private activities: WorkstreamActivity[] = [];
  private currentPhase = "IDLE";
  private _overallStatus: WorkstreamOverallStatus = "idle";
  private _objective: string | null = null;
  private _phase: WorkstreamPhase | null = null;
  private _nextAction: string | null = null;
  private _verification: VerificationState | null = null;

  snapshot(): WorkstreamSnapshot {
    return {
      activities: [...this.activities],
      currentPhase: this.currentPhase,
      hasRunning: this.activities.some((a) => a.status === "running"),
      overallStatus: this._overallStatus,
      objective: this._objective,
      phase: this._phase,
      nextAction: this._nextAction,
      verification: this._verification,
      hiddenCount: Math.max(0, this.activities.length - MAX_ACTIVITIES),
    };
  }

  /** Set the current phase without adding an activity. */
  setPhase(phase: string): void {
    this.currentPhase = phase;
  }

  /** Set the standardized workstream phase (drives the active-state header). */
  setWorkstreamPhase(phase: WorkstreamPhase): void {
    this._phase = phase;
    // Map to the legacy currentPhase string for backward compat
    this.currentPhase = PHASE_DISPLAY[phase];
    // Update overall status to running if currently idle
    if (this._overallStatus === "idle") this._overallStatus = "running";
  }

  /** Set the current objective (one sentence). */
  setObjective(text: string): void {
    this._objective = text;
    if (this._overallStatus === "idle") this._overallStatus = "running";
  }

  /** Set the next action LiTT expects to take. */
  setNextAction(text: string | null): void {
    this._nextAction = text;
  }

  /** Start a verification phase with a set of named checks. */
  startVerification(checkLabels: string[]): void {
    this._verification = {
      status: "running",
      checks: checkLabels.map((label) => ({
        id: nextId(),
        label,
        status: "pending" as const,
      })),
    };
    this.setWorkstreamPhase("verifying");
  }

  /** Update a specific verification check by label. */
  updateVerificationCheck(label: string, status: VerificationCheck["status"], detail?: string): void {
    if (!this._verification) return;
    const check = this._verification.checks.find((c) => c.label === label);
    if (!check) return;
    check.status = status;
    if (detail !== undefined) check.detail = detail;
    // Update overall verification status
    const all = this._verification.checks;
    if (all.every((c) => c.status === "passed")) {
      this._verification.status = "passed";
    } else if (all.some((c) => c.status === "failed")) {
      this._verification.status = "failed";
    } else {
      this._verification.status = "running";
    }
  }

  /** Clear verification state. */
  clearVerification(): void {
    this._verification = null;
  }

  /** Mark the workstream as blocked (e.g. waiting for approval). */
  setBlocked(): void {
    this._overallStatus = "blocked";
    this._phase = "blocked";
    this.currentPhase = "BLOCKED";
  }

  /** Mark the workstream as complete. */
  setComplete(): void {
    this._overallStatus = "complete";
    this._phase = "complete";
    this.currentPhase = "COMPLETE";
  }

  /** Mark the workstream as failed. */
  setFailed(): void {
    this._overallStatus = "failed";
    this._phase = "failed";
    this.currentPhase = "FAILED";
  }

  /** Add a new running activity. Returns its id. */
  begin(
    kind: WorkstreamKind,
    phase: string | null,
    label: string,
    subject?: string,
  ): string {
    const record: WorkstreamActivity = {
      id: nextId(),
      kind,
      status: "running",
      ts: Date.now(),
      phase: phase ?? PHASE_LABELS[kind],
      label,
      ...(subject ? { subject } : {}),
    };
    this.push(record);
    this.currentPhase = record.phase;
    if (this._overallStatus === "idle") this._overallStatus = "running";
    return record.id;
  }

  /** Add an immediate (non-running) activity (reason/inspect/warning). */
  add(
    kind: WorkstreamKind,
    phase: string | null,
    label: string,
    subject?: string,
  ): string {
    const record: WorkstreamActivity = {
      id: nextId(),
      kind,
      status: "complete",
      ts: Date.now(),
      phase: phase ?? PHASE_LABELS[kind],
      label,
      ...(subject ? { subject } : {}),
    };
    this.push(record);
    this.currentPhase = record.phase;
    if (this._overallStatus === "idle") this._overallStatus = "running";
    return record.id;
  }



  /** A concise user-facing conclusion (NEVER chain-of-thought). */
  addReason(label: string, phase: string | null = "WORKING"): string {
    return this.add("reason", phase, label);
  }

  /** A file being inspected. */
  addInspect(file: string): string {
    return this.add("inspect", "INSPECTING", "Inspecting", file);
  }

  /** Record an edit with +/- counts and an optional unified diff. */
  addEdit(
    file: string,
    added: number,
    removed: number,
    diff?: string[],
    phase: string | null = "EDITING",
  ): string {
    const id = this.begin("edit", phase, file, file);
    this.complete(id, { added, removed, diff, success: true });
    return id;
  }

  /** Mark an edit failed (e.g. "Expected text was not found"). */
  failEdit(file: string, reason: string): string {
    const id = this.begin("edit", "EDITING", file, file);
    this.fail(id, reason);
    return id;
  }

  /** Record a tool run (friendly label) with optional command. */
  addTool(
    label: string,
    command?: string,
    elapsedMs?: number,
    success = true,
  ): string {
    const id = this.begin("tool", "EXECUTING", label);
    this.complete(id, { command, elapsedMs, success });
    return id;
  }

  /** Record a shell command run. */
  addCommand(command: string, elapsedMs?: number, success = true): string {
    const id = this.begin("command", "EXECUTING", command, command);
    this.complete(id, { command, elapsedMs, success });
    return id;
  }

  /** Record test progress with counts. */
  addTest(
    file: string,
    passed: number,
    failed: number,
    skipped: number,
    status: "complete" | "failed" = failed > 0 ? "failed" : "complete",
  ): string {
    const id = this.begin(
      "test",
      "TESTING",
      status === "failed" ? `${file} — ${failed} failed` : file,
      file,
    );
    this.complete(id, { passed, failed, skipped, success: status === "complete" });
    if (status === "failed") {
      const a = this.byId(id);
      if (a) a.status = "failed";
    }
    return id;
  }

  /** Record a verification gate result. */
  addVerify(
    label: string,
    success: boolean,
    elapsedMs?: number,
    detail?: string,
  ): string {
    const id = this.begin("verify", "VERIFYING", label);
    this.complete(id, { elapsedMs, success, ...(detail ? { reason: detail } : {}) });
    if (!success) {
      const a = this.byId(id);
      if (a) a.status = "failed";
    }
    return id;
  }

  /** Record a non-fatal warning. */
  addWarning(label: string): string {
    return this.add("warning", "WORKING", label);
  }

  /**
   * Record a retry of a previous activity. The failed parent stays visible;
   * the retry activity links back to it via retriesOf.
   */
  addRetry(parentId: string, reason: string): string {
    const parent = this.byId(parentId);
    // A retry is its own phase (RETRYING), not the parent's phase — the
    // parent stays visible with its original phase; the retry is distinct.
    void parent;
    const id = this.add("retry", "RETRYING", reason);
    const a = this.byId(id);
    if (a) {
      a.retriesOf = parentId;
      a.reason = reason;
    }
    return id;
  }

  /** Mark the whole workstream success (phase COMPLETE). */
  addSuccess(label: string): string {
    this.currentPhase = "COMPLETE";
    this._overallStatus = "complete";
    this._phase = "complete";
    return this.add("success", "COMPLETE", label);
  }

  /** Terminalize a running activity as complete. */
  complete(
    id: string,
    opts: {
      added?: number;
      removed?: number;
      diff?: string[];
      command?: string;
      elapsedMs?: number;
      success?: boolean;
      passed?: number;
      failed?: number;
      skipped?: number;
      reason?: string;
    } = {},
  ): void {
    const idx = this.index(id);
    if (idx === -1) return;
    const a = this.activities[idx];
    if (a.status !== "running") return; // terminal — no-op
    this.activities = [
      ...this.activities.slice(0, idx),
      {
        ...a,
        status: "complete",
        added: opts.added ?? a.added,
        removed: opts.removed ?? a.removed,
        diff: opts.diff ?? a.diff,
        command: opts.command ?? a.command,
        elapsedMs: opts.elapsedMs ?? a.elapsedMs ?? 0,
        success: opts.success ?? true,
        passed: opts.passed ?? a.passed,
        failed: opts.failed ?? a.failed,
        skipped: opts.skipped ?? a.skipped,
        reason: opts.reason ?? a.reason,
      },
      ...this.activities.slice(idx + 1),
    ];
  }

  /** Terminalize a running activity as failed. A failed operation stays
   *  visible even if a later retry succeeds (never hide a failure). */
  fail(id: string, reason?: string): void {
    const idx = this.index(id);
    if (idx === -1) return;
    const a = this.activities[idx];
    if (a.status !== "running") return;
    this.activities = [
      ...this.activities.slice(0, idx),
      { ...a, status: "failed", reason: reason ?? a.reason },
      ...this.activities.slice(idx + 1),
    ];
  }

  /** Toggle the expanded/collapsed detail state of an activity. */
  toggleExpand(id: string): void {
    const idx = this.index(id);
    if (idx === -1) return;
    const a = this.activities[idx];
    this.activities = [
      ...this.activities.slice(0, idx),
      { ...a, expanded: !a.expanded },
      ...this.activities.slice(idx + 1),
    ];
  }

  /** Number of activities. */
  length(): number {
    return this.activities.length;
  }

  /** Reset everything. */
  clear(): void {
    this.activities = [];
    this.currentPhase = "IDLE";
    this._overallStatus = "idle";
    this._objective = null;
    this._phase = null;
    this._nextAction = null;
    this._verification = null;
  }

  private push(a: WorkstreamActivity): void {
    this.activities = [...this.activities.slice(-(MAX_ACTIVITIES - 1)), a];
  }

  private index(id: string): number {
    return this.activities.findIndex((a) => a.id === id);
  }

  byId(id: string): WorkstreamActivity | undefined {
    return this.activities.find((a) => a.id === id);
  }
}

