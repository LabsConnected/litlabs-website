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
    // gate can answer it.
    if (this._healthRequested()) {
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

    // Resolve the exact step whose contract is being verified.
    //
    // Tests and specialized callers may explicitly provide
    // stepRequiredEvidence. In the real runtime, the canonical store is
    // authoritative and supplies the active working/verifying step.
    const mission = this._store?.getMission();
    const activeStep = mission?.steps.find(
      (step) =>
        step.status === "working" ||
        step.status === "verifying",
    ) ?? null;

    const requiredEvidence = this._stepRequiredEvidence
      ? [...this._stepRequiredEvidence()]
      : [...(activeStep?.requiredEvidence ?? [])];

    const evidenceStepId = activeStep?.id ?? null;

    // Fail closed: if a step declares requiredEvidence but no typed
    // evidence checker exists, every declared type remains missing.
    const missingRequiredEvidence = requiredEvidence.filter(
      (type) =>
        !this._hasSuccessfulEvidenceType?.(
          type,
          evidenceStepId,
        ),
    );
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
        ? missingRequiredEvidence.length === 0
        : hasSuccess;

    const proven = positiveEvidence && !hasFailures;

    this._emit("verification_start", { runId, checks: ["evidence"] }, runId);
    if (this._store) this._store.setPhase("verifying");

    let message: string;
    if (missingRequiredEvidence.length > 0) {
      message =
        `Missing required evidence: ${missingRequiredEvidence.join(", ")}. ` +
        `Collected: ${summary}`;
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
  /** True when at least one OBJECTIVE tool result FAILED. */
  hasFailedEvidence(): boolean;
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
      if (!mutated && isMutatingToolCall(toolId, mutationTools, inputs, cwd)) {
        mutated = true;
        onMutation?.();
      }
    },
    recordToolResult(
      toolId: string,
      success: boolean,
      message: string,
      stepId?: string | null,
    ): void {
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
      return !mutated;
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
      return results.some((r) => !r.success && !r.health);
    },
    hasFailedHealthCheck(): boolean {
      return results.some((r) => !r.success && r.health);
    },
    failedSummary(): string {
      const failed = results.filter((r) => !r.success && !r.health);
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
