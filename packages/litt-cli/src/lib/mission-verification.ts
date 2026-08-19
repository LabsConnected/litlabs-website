/**
 * MissionVerificationGate — read-only mission verification.
 *
 * THE RULE: COMPLETE ≠ model says done. COMPLETE = the runtime proved it.
 *
 * For a READ-ONLY (inspection) mission there is nothing to build or test —
 * nothing was mutated. Running the full typecheck/test/build gate is
 * wrong: it takes minutes, holds the mission in RUNNING, and provides no
 * evidence about the inspection itself. The honest proof for an
 * inspection mission is that real tool evidence was collected: at least
 * one read-only project tool (e.g. project.status) returned success.
 *
 * This gate wraps the full VerificationGate:
 *   - read-only missions → evidence gate (fast, honest)
 *   - mutating missions  → full gate (typecheck/test/build, unchanged)
 *
 * It implements the agent-core VerificationGate interface so it can be
 * wired directly into runAgentLoop's verificationGate slot — the loop's
 * repair/revalidation loop then works unchanged for both kinds.
 */

import type {
  VerificationGateLike,
  VerificationResult,
  CheckResult,
  RuntimeStore,
  RuntimeEventEmitter,
} from "@litt/agent-core";

export interface MissionVerificationGateOptions {
  /** The full gate — used when the mission mutated the project. */
  fullGate: VerificationGateLike;
  /** The canonical RuntimeStore (for phase transitions + audit). */
  store?: RuntimeStore | null;
  /** Optional event emitter — mirrors the full gate's canonical
   *  verification_* lifecycle events so read-only missions participate
   *  in the same event bus (activity feed, audits). */
  emitter?: RuntimeEventEmitter | null;
  /** True when the mission made no project mutations. Evaluated at verify() time. */
  isReadOnly: () => boolean;
  /** True when at least one read-only tool produced a successful result. */
  hasSuccessfulEvidence: () => boolean;
  /** Human summary of the collected evidence (tool results). */
  evidenceSummary: () => string;
}

export class MissionVerificationGate implements VerificationGateLike {
  private readonly _fullGate: VerificationGateLike;
  private readonly _store: RuntimeStore | null;
  private readonly _emitter: RuntimeEventEmitter | null;
  private readonly _isReadOnly: () => boolean;
  private readonly _hasSuccessfulEvidence: () => boolean;
  private readonly _evidenceSummary: () => string;

  constructor(options: MissionVerificationGateOptions) {
    this._fullGate = options.fullGate;
    this._store = options.store ?? null;
    this._emitter = options.emitter ?? null;
    this._isReadOnly = options.isReadOnly;
    this._hasSuccessfulEvidence = options.hasSuccessfulEvidence;
    this._evidenceSummary = options.evidenceSummary;
  }

  async verify(): Promise<VerificationResult> {
    // Mutating missions keep the full runtime gate — nothing changes.
    if (!this._isReadOnly()) {
      return this._fullGate.verify();
    }

    // ─── Read-only inspection: evidence gate ─────────────────────
    // Proof = a successful tool result exists on the canonical mission.
    const runId = `verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const t0 = Date.now();
    const proven = this._hasSuccessfulEvidence();
    const summary = this._evidenceSummary();

    this._emit("verification_start", { runId, checks: ["evidence"] }, runId);
    if (this._store) this._store.setPhase("verifying");

    const check: CheckResult = {
      id: "evidence",
      status: proven ? "success" : "failed",
      success: proven,
      exitCode: proven ? 0 : 1,
      message: proven
        ? `Evidence collected: ${summary}`
        : `No successful tool evidence — ${summary}`,
      durationMs: 0,
      runId,
      toolCallId: "",
    };

    this._emit(
      "verification_check_start",
      { runId, toolCallId: "", check: "evidence", label: "Evidence" },
      runId,
      "",
    );
    this._emit(
      "verification_check_result",
      { runId, toolCallId: "", check: "evidence", status: check.status, success: check.success, exitCode: check.exitCode, durationMs: 0 },
      runId,
      "",
    );

    const totalDurationMs = Date.now() - t0;
    const result: VerificationResult = {
      proven,
      status: proven ? "proven" : "failed",
      checks: [check],
      totalDurationMs,
      message: proven
        ? `Repository inspection verified: ${summary}`
        : "Repository inspection could not be verified: no successful tool evidence was collected.",
      runId,
      ranChecks: ["evidence"],
      skippedChecks: [],
    };

    this._emit(
      "verification_result",
      { runId, proven, status: result.status, ranChecks: result.ranChecks, skippedChecks: result.skippedChecks, message: result.message, totalDurationMs },
      runId,
    );

    if (this._store) this._store.setPhase(proven ? "complete" : "failed");

    return result;
  }

  private _emit(
    subtype: string,
    data: Record<string, unknown>,
    runId: string,
    toolCallId?: string,
  ): void {
    if (!this._emitter) return;
    try {
      this._emitter({
        type: "litt_event",
        subtype,
        ts: Date.now(),
        data,
        runId,
        toolCallId,
      });
    } catch {
      // emitter must never crash the gate
    }
  }
}

/**
 * The /ship commit gate — the runtime's defense-in-depth rule.
 * A commit is allowed ONLY when the last verification run PROVEN the
 * work. `null` (no verification ever ran) and `proven: false` (a
 * failed/blocked gate) both reject. Pure + exported so the controller
 * and its regression tests share the exact same rule.
 */
export function isShipCommitAllowed(lastVerification: VerificationResult | null): boolean {
  return lastVerification?.proven === true;
}

/**
 * Track tool outcomes for the evidence gate. The controller feeds this
 * synchronously from agent_tool_call / agent_tool_result events — no
 * async store reads, no races with the loop's verify() call.
 */
export interface MissionEvidenceTracker {
  /** Call on every agent_tool_call. */
  recordToolCall(toolId: string): void;
  /** Call on every agent_tool_result. */
  recordToolResult(toolId: string, success: boolean, message: string): void;
  /** True when the mission mutated the project. */
  isReadOnly(): boolean;
  /** True when at least one tool result succeeded. */
  hasSuccessfulEvidence(): boolean;
  /** Human summary of results. */
  summary(): string;
}

/**
 * Mark every non-terminal step of a read-only inspection mission as
 * passed, so the canonical mission can honestly reach "complete".
 *
 * For an inspection mission the plan steps (inspect → verify → report)
 * are all satisfied by the collected evidence + the delivered answer —
 * there is no remaining semantic work. Without this, later plan steps
 * stay "pending" and RuntimeStore.completeMission() refuses the
 * transition, leaving the canonical mission stuck at "verifying" while
 * the UI shows COMPLETE (and the mission would resurrect on restart).
 *
 * Safety: only called for READ-ONLY missions whose evidence gate proved
 * (verified by the caller). A step that FAILED a read-only tool attempt
 * is recovered through the state machine (failed → working → passed) —
 * the mission was runtime-proven via other evidence, so the failed
 * attempt is recorded history, not a blocker. Blocked steps are left
 * untouched.
 */
export async function markInspectionStepsComplete(
  store: RuntimeStore,
  reason: string,
): Promise<void> {
  const mission = store.getMission();
  if (!mission) return;
  for (const step of mission.steps) {
    if (step.status === "pending" || step.status === "failed") {
      // pending/failed → passed is not a valid step transition; the
      // state machine requires going through working first.
      await store.updateMissionStepStatus(step.id, "working", {
        verificationPassed: true,
        verificationEvidence: reason,
      }).catch(() => {});
    }
    if (step.status === "working" || step.status === "verifying") {
      await store.updateMissionStepStatus(step.id, "passed", {
        verificationPassed: true,
        verificationEvidence: reason,
      }).catch(() => {});
    }
  }
}

/** Bounded history — long missions must not grow memory forever. */
const MAX_EVIDENCE_RESULTS = 200;

export function createMissionEvidenceTracker(
  mutationTools: ReadonlySet<string>,
): MissionEvidenceTracker {
  let mutated = false;
  const results: { toolId: string; success: boolean; message: string }[] = [];

  return {
    recordToolCall(toolId: string): void {
      if (mutationTools.has(toolId)) mutated = true;
    },
    recordToolResult(toolId: string, success: boolean, message: string): void {
      results.push({ toolId, success, message: message.slice(0, 200) });
      if (results.length > MAX_EVIDENCE_RESULTS) results.shift();
    },
    isReadOnly(): boolean {
      return !mutated;
    },
    hasSuccessfulEvidence(): boolean {
      return results.some((r) => r.success);
    },
    summary(): string {
      if (results.length === 0) return "no tool evidence collected";
      return results
        .map((r) => `${r.toolId}: ${r.success ? "ok" : "failed"}`)
        .join("; ");
    },
  };
}
