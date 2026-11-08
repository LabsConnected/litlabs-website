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

import { classifyCommand, toolToEvidenceType } from "@litt/agent-core";
import type {
  VerificationGateLike,
  VerificationResult,
  CheckResult,
  EvidenceType,
  RuntimeStore,
  RuntimeEventEmitter,
} from "@litt/agent-core";

// ─── Verification scope ────────────────────────────────────────────

/**
 * Tools that report PROJECT HEALTH rather than answer a question.
 * They are expensive (a full suite is minutes) and, for an inspection
 * mission, entirely optional: nothing about "what branch am I on" is
 * proven or disproven by whether the test suite is green.
 */
const HEALTH_CHECK_TOOLS: ReadonlySet<string> = new Set([
  "project.test",
  "project.build",
  "project.typecheck",
  "project.check",
]);

/** Package-manager script names that mean "run project health checks". */
const HEALTH_SCRIPTS: ReadonlySet<string> = new Set([
  "test",
  "tests",
  "build",
  "typecheck",
  "type-check",
  "lint",
]);

/**
 * Phrases that mean the user actually asked about project health. Only
 * then may an inspection mission be gated on the full suite.
 *
 * Deliberately narrow: "status" or "check the branch" must NOT match,
 * or we are back to turning a one-second Git question into an
 * eight-minute audit.
 */
const HEALTH_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(run|execute)\b[^.?!]{0,40}\b(tests?|test suite|build|typecheck|type-check|lint)\b/i,
  /\b(project|full|overall|repo|repository)\s+health\b/i,
  /\bhealth\s+check\b/i,
  /\bverify\b[^.?!]{0,40}\b(health|tests?|build|compiles?|typecheck)\b/i,
  /\b(do|does|are)\b[^.?!]{0,30}\b(tests?|builds?)\b[^.?!]{0,20}\b(pass|passing|green|work)\b/i,
  /\bis\b[^.?!]{0,30}\b(build|suite|project)\b[^.?!]{0,20}\b(green|passing|healthy|broken)\b/i,
  /\b(compiles?|typechecks?|builds?)\s+(cleanly|successfully|ok)\b/i,
];

/**
 * Does the user's request actually ask about project health?
 *
 * This is the switch between "prove the facts I asked for" and "prove
 * the project is healthy". A read-only inspection defaults to the
 * former — the expensive suite is not implied by asking a question.
 */
export function requiresProjectHealth(requestText: string | null | undefined): boolean {
  if (!requestText) return false;
  return HEALTH_REQUEST_PATTERNS.some((re) => re.test(requestText));
}

/**
 * Is this tool call a project-health check rather than an objective?
 *
 * `project.run` is the generic escape hatch, so it is judged by the
 * command it actually runs — `pnpm run test` is a health check, `git
 * status` is not.
 */
export function isHealthCheckTool(
  toolId: string,
  inputs?: Record<string, unknown> | null,
): boolean {
  if (HEALTH_CHECK_TOOLS.has(toolId)) return true;
  if (toolId !== "project.run" || !inputs) return false;
  const command = typeof inputs.command === "string" ? inputs.command.toLowerCase() : "";
  const args = Array.isArray(inputs.args)
    ? inputs.args.filter((a): a is string => typeof a === "string")
    : [];
  if (["npm", "pnpm", "yarn", "bun"].includes(command)) {
    // `pnpm test` and `pnpm run test` both count.
    const script = args[0] === "run" ? args[1] : args[0];
    return typeof script === "string" && HEALTH_SCRIPTS.has(script.toLowerCase());
  }
  if (command === "npx" || command === "tsc") {
    return args.includes("--noEmit") || args.includes("tsc");
  }
  if (command === "vitest" || command === "jest") return true;
  return false;
}

/**
 * Does this tool call mutate the project?
 *
 * `project.run` must be judged by its actual command. Classifying the
 * whole tool as mutating is what made a read-only Git inspection
 * escalate to the full test suite: six `git rev-parse`/`status`/`log`
 * calls flipped the mission to "mutating", which sent verification to
 * the full typecheck/test/build gate.
 *
 * Falls back to the static tool set when no inputs are available —
 * unknown means "assume mutating", never the reverse.
 */
export function isMutatingToolCall(
  toolId: string,
  mutationTools: ReadonlySet<string>,
  inputs?: Record<string, unknown> | null,
  cwd?: string,
): boolean {
  if (toolId === "project.run" && inputs) {
    const command = typeof inputs.command === "string" ? inputs.command : "";
    if (!command) return true; // malformed call — stay conservative
    const args = Array.isArray(inputs.args)
      ? inputs.args.filter((a): a is string => typeof a === "string")
      : [];
    try {
      return classifyCommand(command, args, cwd).mutating;
    } catch {
      return true;
    }
  }
  return mutationTools.has(toolId);
}

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
  /**
   * Canonical typed-evidence lookup. Required whenever a mission step
   * declares requiredEvidence. stepId scopes evidence to the active step.
   */
  hasSuccessfulEvidenceType?: (
    type: EvidenceType,
    stepId?: string | null,
  ) => boolean;
  /**
   * Required evidence for the step being verified.
   * When omitted, the gate reads it from the active RuntimeStore step.
   */
  stepRequiredEvidence?: () => readonly EvidenceType[];
  /** True when at least one read-only tool FAILED. When true, the
   *  evidence gate must NOT prove the mission complete — a failed
   *  objective means the user's request was only partially fulfilled. */
  hasFailedEvidence: () => boolean;
  /**
   * Per-type evidence state for the mission's required-evidence
   * contract. "attempted" = the producer tool ran at least once;
   * "failed" = it ran and every result failed (none succeeded).
   * Required for the mission-scoped requiredEvidence check.
   */
  evidenceTypeState?: (type: EvidenceType) => { attempted: boolean; succeeded: boolean; failed: boolean; lastFailureMessage: string };
  /**
   * Titles of mission steps that still lack successful evidence.
   * Synthesis steps (report/verify/plan/summarize scopes or titles) are
   * excluded by the implementation.
   */
  uncoveredStepTitles?: () => string[];
  /** Human summary of the collected evidence (tool results). */
  evidenceSummary: () => string;
  /** Human summary of FAILED results only (for truthful failure messages). */
  failedSummary: () => string;
  /**
   * True when the user's request actually asked about project health.
   * When true, a read-only mission still delegates to the full gate —
   * "do the tests pass?" can only be answered by running them.
   * Defaults to false: asking a question is not asking for an audit.
   */
  healthRequested?: () => boolean;
  /** True when an OPTIONAL project-health check failed. */
  hasFailedHealthCheck?: () => boolean;
  /** Human summary of failed optional health checks. */
  healthSummary?: () => string;
}

export class MissionVerificationGate implements VerificationGateLike {
  private readonly _fullGate: VerificationGateLike;
  private readonly _store: RuntimeStore | null;
  private readonly _emitter: RuntimeEventEmitter | null;
  private readonly _isReadOnly: () => boolean;
  private readonly _hasSuccessfulEvidence: () => boolean;
  private readonly _hasSuccessfulEvidenceType:
    | ((type: EvidenceType, stepId?: string | null) => boolean)
    | null;
  private readonly _stepRequiredEvidence:
    | (() => readonly EvidenceType[])
    | null;
  private readonly _hasFailedEvidence: () => boolean;
  private readonly _evidenceTypeState:
    | ((type: EvidenceType) => { attempted: boolean; succeeded: boolean; failed: boolean; lastFailureMessage: string })
    | null;
  private readonly _uncoveredStepTitles: (() => string[]) | null;
  private readonly _evidenceSummary: () => string;
  private readonly _failedSummary: () => string;
  private readonly _healthRequested: () => boolean;
  private readonly _hasFailedHealthCheck: () => boolean;
  private readonly _healthSummary: () => string;

  constructor(options: MissionVerificationGateOptions) {
    this._fullGate = options.fullGate;
    this._store = options.store ?? null;
    this._emitter = options.emitter ?? null;
    this._isReadOnly = options.isReadOnly;
    this._hasSuccessfulEvidence = options.hasSuccessfulEvidence;
    this._hasSuccessfulEvidenceType =
      options.hasSuccessfulEvidenceType ?? null;
    this._stepRequiredEvidence =
      options.stepRequiredEvidence ?? null;
    this._hasFailedEvidence = options.hasFailedEvidence;
    this._evidenceTypeState = options.evidenceTypeState ?? null;
    this._uncoveredStepTitles = options.uncoveredStepTitles ?? null;
    this._evidenceSummary = options.evidenceSummary;
    this._failedSummary = options.failedSummary;
    this._healthRequested = options.healthRequested ?? (() => false);
    this._hasFailedHealthCheck = options.hasFailedHealthCheck ?? (() => false);
    this._healthSummary = options.healthSummary ?? (() => "");
  }

  async verify(): Promise<VerificationResult> {
    // Mutating missions keep the full runtime gate — nothing changes.
    if (!this._isReadOnly()) {
      return this._fullGate.verify();
    }

    // The user explicitly asked about project health. Then the suite IS
    // the requested objective, not an optional extra, and only the full
    // gate can answer it — UNLESS the plan already narrowed that request
    // to declared check evidence (a step requiring typecheck_result is
    // satisfied by project.check alone; the full suite is not the ask).
    const missionSteps = this._store?.getMission()?.steps ?? [];
    const declaresCheckEvidence = missionSteps.some((s) =>
      (s.requiredEvidence ?? []).some((e) =>
        e === "typecheck_result" || e === "test_result" || e === "build_result",
      ),
    );
    if (this._healthRequested() && !declaresCheckEvidence) {
      return this._fullGate.verify();
    }

    // ─── Read-only inspection: evidence gate ─────────────────────
    // Proof requires BOTH:
    //   1. At least one successful tool result (positive evidence)
    //   2. NO failed tool results (all requested objectives succeeded)
    //
    // A compound request where repo inspection succeeds but weather
    // lookup fails must NOT be COMPLETE — the user's entire request
    // was not fulfilled. The gate returns proven=false with a truthful
    // message listing which objectives failed.
    const runId = `verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const t0 = Date.now();
    const hasSuccess = this._hasSuccessfulEvidence();
    const hasFailures = this._hasFailedEvidence();
    const summary = this._evidenceSummary();

    // Required evidence is the union of every mission step's contract —
    // a step's evidence proves the mission, not just that step. The
    // VerificationGate's own output type is never a step contract.
    const mission = this._store?.getMission();
    const activeStep = mission?.steps.find(
      (step) =>
        step.status === "working" ||
        step.status === "verifying",
    ) ?? null;

    const requiredEvidence: EvidenceType[] = this._stepRequiredEvidence
      ? [...this._stepRequiredEvidence()]
      : [...new Set(
          (mission?.steps ?? [])
            .flatMap((s) => s.requiredEvidence ?? [])
            .filter((e) => e !== "verification_result"),
        )];

    // Fail closed: if the mission declares requiredEvidence but no typed
    // evidence checker exists, every declared type remains missing.
    const missingRequiredEvidence: EvidenceType[] = [];
    const failedRequiredEvidence: EvidenceType[] = [];
    const failedEvidenceDetails: string[] = [];
    for (const type of requiredEvidence) {
      if (this._evidenceTypeState) {
        const state = this._evidenceTypeState(type);
        if (state.succeeded) continue;
        if (state.attempted || state.failed) {
          failedRequiredEvidence.push(type);
          if (state.lastFailureMessage) failedEvidenceDetails.push(`${type} — ${state.lastFailureMessage}`);
        } else {
          missingRequiredEvidence.push(type);
        }
      } else if (!this._hasSuccessfulEvidenceType?.(type, activeStep?.id ?? null)) {
        missingRequiredEvidence.push(type);
      }
    }

    // Coverage: every non-synthesis step must have produced successful
    // evidence. A report step is allowed to have none — it IS the
    // synthesis of the others' evidence.
    const uncoveredSteps = this._uncoveredStepTitles?.() ?? [];

    const failedSummary = this._failedSummary();
    const healthFailed = this._hasFailedHealthCheck();
    const healthSummary = this._healthSummary();

    // Proven only when there is positive evidence AND no failed
    // OBJECTIVE. An optional health check the model volunteered — a
    // test suite nobody asked about — is reported, never fatal: a red
    // suite does not make "you are on main, tree clean" untrue.
    // A typed evidence contract is stronger than generic "some tool
    // succeeded". When requiredEvidence exists, ALL declared types must
    // have successful evidence. Without a typed contract, preserve the
    // existing inspection rule.
    const positiveEvidence =
      requiredEvidence.length > 0
        ? missingRequiredEvidence.length === 0 && failedRequiredEvidence.length === 0
        : hasSuccess;

    const proven =
      positiveEvidence &&
      !hasFailures &&
      failedRequiredEvidence.length === 0 &&
      uncoveredSteps.length === 0;

    this._emit("verification_start", { runId, checks: ["evidence"] }, runId);
    if (this._store) this._store.setPhase("verifying");

    let message: string;
    if (failedRequiredEvidence.length > 0) {
      message =
        `Required check failed: ${failedEvidenceDetails.length > 0 ? failedEvidenceDetails.join("; ") : failedRequiredEvidence.join(", ")}`;
    } else if (missingRequiredEvidence.length > 0) {
      message =
        `Missing required evidence: ${missingRequiredEvidence.join(", ")}. ` +
        `Collected: ${summary}`;
    } else if (uncoveredSteps.length > 0) {
      message = `Steps without evidence: ${uncoveredSteps.join(", ")}`;
    } else if (proven && healthFailed) {
      // Requirement: never silently redefine an inspection mission as
      // "project fully healthy". Report both facts, separately.
      message =
        `REQUESTED TASK VERIFIED — Evidence collected: ${summary}. ` +
        `OPTIONAL PROJECT HEALTH CHECK FAILED (not required by this request): ${healthSummary}`;
    } else if (proven) {
      message = `REQUESTED TASK VERIFIED — Evidence collected: ${summary}`;
    } else if (hasSuccess && hasFailures) {
      message = `Partial success — some objectives failed: ${failedSummary}. Succeeded: ${summary}`;
    } else if (hasFailures) {
      message = `All tool evidence failed: ${failedSummary}`;
    } else {
      message = `No successful tool evidence — ${summary}`;
    }

    const check: CheckResult = {
      id: "evidence",
      status: proven ? "success" : "failed",
      success: proven,
      exitCode: proven ? 0 : 1,
      message,
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
      message,
      runId,
      ranChecks: ["evidence"],
      skippedChecks: [],
      ...(missingRequiredEvidence.length > 0 ? { missingEvidence: missingRequiredEvidence } : {}),
      ...(failedRequiredEvidence.length > 0 ? { failedEvidence: failedRequiredEvidence } : {}),
      ...(uncoveredSteps.length > 0 ? { uncoveredSteps } : {}),
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
  /**
   * Call on every agent_tool_call. Pass the tool's `inputs` whenever
   * they are available — `project.run` can only be classified by the
   * command it actually runs.
   */
  recordToolCall(toolId: string, inputs?: Record<string, unknown> | null): void;
  /** Call on every agent_tool_result. */
  recordToolResult(
    toolId: string,
    success: boolean,
    message: string,
    stepId?: string | null,
  ): void;
  /** True when the mission mutated the project. */
  isReadOnly(): boolean;
  /** True when at least one OBJECTIVE tool result succeeded. */
  hasSuccessfulEvidence(): boolean;
  /**
   * True when successful evidence of the requested canonical type exists.
   * When stepId is supplied, evidence MUST belong to that exact step.
   */
  hasSuccessfulEvidenceType(
    type: EvidenceType,
    stepId?: string | null,
  ): boolean;
  /** True when at least one OBJECTIVE tool result FAILED and was never
   *  recovered by a later success of the same tool. */
  hasFailedEvidence(): boolean;
  /**
   * Per-type evidence state for the mission's required-evidence
   * contract. attempted = any record of that type; succeeded = at least
   * one successful record; failed = records exist and none succeeded.
   */
  evidenceTypeState(type: EvidenceType): { attempted: boolean; succeeded: boolean; failed: boolean; lastFailureMessage: string };
  /** True when an optional project-health check failed. */
  hasFailedHealthCheck(): boolean;
  /** Human summary of results. */
  summary(): string;
  /** Human summary of FAILED objective results only. */
  failedSummary(): string;
  /** Human summary of failed optional health checks. */
  healthSummary(): string;
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
/** Steps whose job is to synthesize other steps' evidence — they are
 *  covered by the final answer itself, not by tool evidence. */
const SYNTHESIS_SCOPES: ReadonlySet<string> = new Set([
  "report",
  "verify",
  "plan",
  "summarize",
]);
const SYNTHESIS_TITLE_RE =
  /\b(report|summar\w*|recommend\w*|propos\w*|design\w*|verif\w*|conclu\w*|present\w*|deliver\w*)\b/i;

export function isSynthesisStep(step: {
  title: string;
  allowedActionScope: readonly string[];
}): boolean {
  return (
    step.allowedActionScope.some((s) => SYNTHESIS_SCOPES.has(s)) ||
    SYNTHESIS_TITLE_RE.test(step.title)
  );
}

/**
 * Titles of mission steps that produced no successful evidence.
 * Synthesis steps are exempt — a "Report findings" step's output is
 * the final answer, not a tool call.
 */
export function uncoveredMissionSteps(
  mission: { steps: readonly { id: string; title: string; allowedActionScope: readonly string[] }[]; evidence: readonly { stepId: string | null; success?: boolean }[] } | null | undefined,
): string[] {
  if (!mission) return [];
  return mission.steps
    .filter((s) => !isSynthesisStep(s))
    .filter(
      (s) =>
        !mission.evidence.some((e) => e.stepId === s.id && e.success === true),
    )
    .map((s) => s.title);
}

export async function markInspectionStepsComplete(
  store: RuntimeStore,
  reason: string,
): Promise<void> {
  const mission = store.getMission();
  if (!mission) return;

  // The evidence gate verified the current semantic step.
  // Later steps with their own requiredEvidence MUST NOT be
  // auto-passed by inspection completion.
  const verifiedStepId = mission.currentStepId;

  for (const step of mission.steps) {
    const hasOwnEvidenceContract =
      Array.isArray(step.requiredEvidence) &&
      step.requiredEvidence.length > 0;

    if (hasOwnEvidenceContract && step.id !== verifiedStepId) {
      continue;
    }

    if (step.status === "pending" || step.status === "failed") {
      // Transition first without stamping verification twice.
      await store.updateMissionStepStatus(
        step.id,
        "working",
      ).catch(() => {});
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

export interface MissionEvidenceTrackerOptions {
  /** Project root — lets `project.run` commands be classified in context. */
  cwd?: string;
  /**
   * Called when a mutating tool call is seen. Wire this to the
   * VerificationEvidenceCache so cached check results are invalidated
   * the moment the project changes.
   */
  onMutation?: () => void;
}

export function createMissionEvidenceTracker(
  mutationTools: ReadonlySet<string>,
  options?: MissionEvidenceTrackerOptions,
): MissionEvidenceTracker {
  let mutated = false;
  const cwd = options?.cwd;
  const onMutation = options?.onMutation;
  // A tool is an optional health check only if its CALL said so; the
  // result event carries no inputs, so remember the classification.
  const healthTools = new Set<string>();
  /**
   * Mutating calls awaiting their result, in call order. recordToolCall
   * classifies with inputs (project.run needs the actual command);
   * recordToolResult consumes one entry per result so a DENIED or
   * cancelled mutation attempt never counts as an executed mutation.
   */
  const pendingMutationCalls: string[] = [];
  let executedMutations = 0;
  /**
   * Failures that prove the command NEVER ran — approval denied or
   * cancelled before spawn. Anything else (exit codes, timeouts,
   * partial output) may have changed the project and stays conservative.
   */
  const NON_EXECUTION_RE = /approval denied|cancelled by user|not available/i;
  const results: {
    toolId: string;
    evidenceType: EvidenceType;
    stepId: string | null;
    success: boolean;
    message: string;
    health: boolean;
  }[] = [];

  return {
    recordToolCall(toolId: string, inputs?: Record<string, unknown> | null): void {
      if (isHealthCheckTool(toolId, inputs)) healthTools.add(toolId);
      if (isMutatingToolCall(toolId, mutationTools, inputs, cwd)) {
        pendingMutationCalls.push(toolId);
        if (!mutated) {
          mutated = true;
          onMutation?.();
        }
      }
    },
    recordToolResult(
      toolId: string,
      success: boolean,
      message: string,
      stepId?: string | null,
    ): void {
      const idx = pendingMutationCalls.indexOf(toolId);
      const wasMutatingAttempt = idx !== -1;
      if (wasMutatingAttempt) pendingMutationCalls.splice(idx, 1);

      // The mission counts as MUTATING only when a mutation could have
      // actually changed the project: a success, or a failure that is
      // not a clean non-execution. A denied project.write_file during a
      // "scan" must not escalate the mission to the full check gate —
      // nothing was written (observed: approval-denied writes flipped
      // isReadOnly() and sent verification into a 14-min stall).
      // project.run is classified per-CALL (a `git status` is read-only,
      // `npm install` is not) — it only counts when THIS call was queued
      // as mutating at recordToolCall time. Always-mutating tools count
      // on any non-denied result.
      const mutatingResult =
        wasMutatingAttempt ||
        (toolId !== "project.run" && mutationTools.has(toolId));
      if (mutatingResult && (success || !NON_EXECUTION_RE.test(message))) {
        executedMutations++;
      }

      results.push({
        toolId,
        evidenceType: toolToEvidenceType(toolId),
        stepId: stepId ?? null,
        success,
        message: message.slice(0, 200),
        health: healthTools.has(toolId),
      });
      if (results.length > MAX_EVIDENCE_RESULTS) results.shift();
    },
    isReadOnly(): boolean {
      // A queued mutation whose result never arrived is UNCERTAIN — it
      // may have run. Stay conservative (not read-only) until the
      // outcome is known; only a clean non-execution result clears it.
      return executedMutations === 0 && pendingMutationCalls.length === 0;
    },
    hasSuccessfulEvidence(): boolean {
      return results.some((r) => r.success && !r.health);
    },
    hasSuccessfulEvidenceType(
      type: EvidenceType,
      stepId?: string | null,
    ): boolean {
      return results.some(
        (r) =>
          r.success &&
          r.evidenceType === type &&
          (stepId == null || r.stepId === stepId),
      );
    },
    hasFailedEvidence(): boolean {
      // Only UNRECOVERED failures count — a tool that failed and later
      // succeeded is recorded history, not an outstanding objective.
      const succeeded = new Set(results.filter((r) => r.success).map((r) => r.toolId));
      return results.some((r) => !r.success && !r.health && !succeeded.has(r.toolId));
    },
    evidenceTypeState(type: EvidenceType): { attempted: boolean; succeeded: boolean; failed: boolean; lastFailureMessage: string } {
      // Required-evidence tracking sees every record of the type —
      // the health/objective split only applies to unrequested checks,
      // never to a type the mission's contract requires.
      const ofType = results.filter((r) => r.evidenceType === type);
      const succeeded = ofType.some((r) => r.success);
      const lastFail = ofType.filter((r) => !r.success).at(-1);
      return {
        attempted: ofType.length > 0,
        succeeded,
        failed: ofType.some((r) => !r.success) && !succeeded,
        lastFailureMessage: lastFail ? `${lastFail.toolId}: ${lastFail.message}` : "",
      };
    },
    hasFailedHealthCheck(): boolean {
      return results.some((r) => !r.success && r.health);
    },
    failedSummary(): string {
      const succeeded = new Set(results.filter((r) => r.success).map((r) => r.toolId));
      const failed = results.filter((r) => !r.success && !r.health && !succeeded.has(r.toolId));
      if (failed.length === 0) return "";
      return failed
        .map((r) => `${r.toolId}: ${r.message.slice(0, 100)}`)
        .join("; ");
    },
    healthSummary(): string {
      const failed = results.filter((r) => !r.success && r.health);
      if (failed.length === 0) return "";
      return failed
        .map((r) => `${r.toolId}: ${r.message.slice(0, 100)}`)
        .join("; ");
    },
    summary(): string {
      if (results.length === 0) return "no tool evidence collected";
      return results
        .map((r) => `${r.toolId}: ${r.success ? "ok" : "failed"}`)
        .join("; ");
    },
  };
}
