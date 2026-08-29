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
}

let idCounter = 0;

function nextId(): string {
  return `ws_${Date.now().toString(36)}_${++idCounter}`;
}

export class WorkstreamStore {
  private activities: WorkstreamActivity[] = [];
  private currentPhase = "IDLE";

  snapshot(): WorkstreamSnapshot {
    return {
      activities: [...this.activities],
      currentPhase: this.currentPhase,
      hasRunning: this.activities.some((a) => a.status === "running"),
    };
  }

  /** Set the current phase without adding an activity. */
  setPhase(phase: string): void {
    this.currentPhase = phase;
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

