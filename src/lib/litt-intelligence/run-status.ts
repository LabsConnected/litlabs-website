/**
 * Run Status Derivation
 *
 * The ready-for-review state is a PURE DERIVED FUNCTION from evidence.
 * The agent NEVER calls setStatus("ready_for_review").
 * Instead: deriveRunStatus(evidence, checks, acceptanceCriteria)
 *
 * Phase 8 — Studio Control Plane V1
 */

import type { MutationEvidence } from "./mutation-evidence";
import type { CheckEvidence } from "./check-evidence";
import type { AcceptanceEvidence } from "./acceptance-evidence";

export type RunStatus =
  | "planning"
  | "awaiting_approval"
  | "acting"
  | "checks_running"
  | "checks_failed"
  | "ready_for_review"
  | "deployed"
  | "failed";

export interface AcceptanceCriterion {
  id: string;
  description: string;
  status: "pending" | "verified" | "failed";
}

export interface DeriveRunStatusInput {
  mutationEvidence: MutationEvidence[];
  checkEvidence: CheckEvidence[];
  /** Acceptance evidence records (Phase 9). If provided, these are used
   *  instead of the simplified acceptanceCriteria. */
  acceptanceEvidence?: AcceptanceEvidence[];
  /** Simplified acceptance criteria (Phase 8 backward compat).
   *  Ignored if acceptanceEvidence is provided. */
  acceptanceCriteria?: AcceptanceCriterion[];
  /** Blocking events that prevent ready-for-review (e.g. unresolved approval denials) */
  unresolvedBlockingEvents: Array<{ id: string; type: string }>;
  /** Whether checks are currently running */
  checksRunning?: boolean;
}

export interface DeriveRunStatusResult {
  status: RunStatus;
  readyForReview: boolean;
  /** Why the run is not ready (if applicable) */
  blockers: string[];
  /** Required checks that haven't passed */
  failedRequiredChecks: CheckEvidence[];
  /** Required checks that were skipped (missing scripts) */
  skippedRequiredChecks: CheckEvidence[];
  /** Checks that are stale (code changed after check ran) */
  staleChecks: CheckEvidence[];
  /** Required acceptance criteria that failed */
  failedAcceptanceCriteria: AcceptanceEvidence[];
  /** Required acceptance criteria that were skipped or unverifiable */
  skippedAcceptanceCriteria: AcceptanceEvidence[];
  /** Acceptance evidence that is stale */
  staleAcceptanceEvidence: AcceptanceEvidence[];
}

/**
 * Derive the run status from evidence.
 *
 * readyForReview is true if and only if ALL of:
 * 1. There is at least one mutation evidence record
 * 2. All mutation evidence records succeeded
 * 3. There is at least one required check
 * 4. All required checks passed
 * 5. All acceptance criteria are verified
 * 6. No unresolved blocking events
 * 7. No stale checks
 */
export function deriveRunStatus(input: DeriveRunStatusInput): DeriveRunStatusResult {
  const { mutationEvidence, checkEvidence, acceptanceEvidence, acceptanceCriteria, unresolvedBlockingEvents, checksRunning } = input;

  const blockers: string[] = [];
  const emptyResult = {
    failedAcceptanceCriteria: [] as AcceptanceEvidence[],
    skippedAcceptanceCriteria: [] as AcceptanceEvidence[],
    staleAcceptanceEvidence: [] as AcceptanceEvidence[],
  };

  // 1. Must have mutations
  if (mutationEvidence.length === 0) {
    return {
      status: "planning",
      readyForReview: false,
      blockers: ["No mutations have been made yet"],
      failedRequiredChecks: [],
      skippedRequiredChecks: [],
      staleChecks: [],
      ...emptyResult,
    };
  }

  // 2. All mutations must succeed
  const failedMutations = mutationEvidence.filter((e) => e.status === "failed");
  if (failedMutations.length > 0) {
    blockers.push(`${failedMutations.length} mutation(s) failed`);
    return {
      status: "failed",
      readyForReview: false,
      blockers,
      failedRequiredChecks: [],
      skippedRequiredChecks: [],
      staleChecks: [],
      ...emptyResult,
    };
  }

  // 3. Identify required checks
  const requiredChecks = checkEvidence.filter((c) => c.required);
  const nonStaleRequiredChecks = requiredChecks.filter((c) => !c.stale);

  if (requiredChecks.length === 0 && !checksRunning) {
    blockers.push("No required checks have been run");
    return {
      status: "acting",
      readyForReview: false,
      blockers,
      failedRequiredChecks: [],
      skippedRequiredChecks: [],
      staleChecks: [],
      ...emptyResult,
    };
  }

  // 4. Find stale checks
  const staleChecks = checkEvidence.filter((c) => c.stale);
  if (staleChecks.length > 0) {
    blockers.push(`${staleChecks.length} check(s) are stale (code changed after check ran)`);
  }

  // 5. Find failed required checks
  const failedRequiredChecks = nonStaleRequiredChecks.filter((c) => c.status === "failed");
  if (failedRequiredChecks.length > 0) {
    blockers.push(`${failedRequiredChecks.length} required check(s) failed: ${failedRequiredChecks.map((c) => c.kind).join(", ")}`);
  }

  // 6. Find skipped required checks (missing scripts)
  const skippedRequiredChecks = nonStaleRequiredChecks.filter((c) => c.status === "skipped");
  if (skippedRequiredChecks.length > 0) {
    blockers.push(`${skippedRequiredChecks.length} required check(s) skipped: ${skippedRequiredChecks.map((c) => c.kind).join(", ")}`);
  }

  // 7. Check if any required checks are still running
  const runningRequiredChecks = nonStaleRequiredChecks.filter((c) => c.status === "running" || c.status === "queued");
  if (runningRequiredChecks.length > 0 || checksRunning) {
    return {
      status: "checks_running",
      readyForReview: false,
      blockers: ["Checks are still running"],
      failedRequiredChecks,
      skippedRequiredChecks,
      staleChecks,
      ...emptyResult,
    };
  }

  // 8. All required checks must pass
  const passedRequiredChecks = nonStaleRequiredChecks.filter((c) => c.status === "passed");
  if (passedRequiredChecks.length < nonStaleRequiredChecks.length) {
    return {
      status: "checks_failed",
      readyForReview: false,
      blockers,
      failedRequiredChecks,
      skippedRequiredChecks,
      staleChecks,
      ...emptyResult,
    };
  }

  // 9. Acceptance criteria verification
  //
  // If acceptanceEvidence is provided (Phase 9), use it.
  // Otherwise fall back to simplified acceptanceCriteria (Phase 8 compat).
  let failedAcceptanceCriteria: AcceptanceEvidence[] = [];
  let skippedAcceptanceCriteria: AcceptanceEvidence[] = [];
  let staleAcceptanceEvidence: AcceptanceEvidence[] = [];

  if (acceptanceEvidence && acceptanceEvidence.length > 0) {
    // Phase 9: use structured acceptance evidence

    // 9a. Find stale acceptance evidence
    staleAcceptanceEvidence = acceptanceEvidence.filter((e) => e.stale);
    if (staleAcceptanceEvidence.length > 0) {
      blockers.push(`${staleAcceptanceEvidence.length} acceptance evidence record(s) stale`);
    }

    // 9b. Required acceptance criteria must be verified
    const requiredAcceptance = acceptanceEvidence.filter((e) => e.required && !e.stale);

    failedAcceptanceCriteria = requiredAcceptance.filter((e) => e.status === "failed");
    if (failedAcceptanceCriteria.length > 0) {
      blockers.push(`${failedAcceptanceCriteria.length} required acceptance criterion/criteria failed`);
    }

    // Skipped or unverifiable required criteria
    skippedAcceptanceCriteria = requiredAcceptance.filter(
      (e) => e.status === "skipped" || e.status === "queued" || e.status === "verifying",
    );
    if (skippedAcceptanceCriteria.length > 0) {
      blockers.push(`${skippedAcceptanceCriteria.length} required acceptance criterion/criteria not verified`);
    }

    // Required criteria with no evidence refs cannot be verified
    const noEvidence = requiredAcceptance.filter(
      (e) => e.status === "verified" && e.evidenceRefs.length === 0,
    );
    if (noEvidence.length > 0) {
      blockers.push(`${noEvidence.length} required acceptance criterion/criteria verified without evidence references`);
    }
  } else if (acceptanceCriteria && acceptanceCriteria.length > 0) {
    // Phase 8 backward compat: simplified criteria
    const unverifiedCriteria = acceptanceCriteria.filter((c) => c.status !== "verified");
    if (unverifiedCriteria.length > 0) {
      blockers.push(`${unverifiedCriteria.length} acceptance criteria not verified`);
    }
  }

  // 10. No unresolved blocking events
  if (unresolvedBlockingEvents.length > 0) {
    blockers.push(`${unresolvedBlockingEvents.length} unresolved blocking event(s)`);
  }

  // Final determination
  if (blockers.length > 0) {
    return {
      status: "checks_failed",
      readyForReview: false,
      blockers,
      failedRequiredChecks,
      skippedRequiredChecks,
      staleChecks,
      failedAcceptanceCriteria,
      skippedAcceptanceCriteria,
      staleAcceptanceEvidence,
    };
  }

  return {
    status: "ready_for_review",
    readyForReview: true,
    blockers: [],
    failedRequiredChecks: [],
    skippedRequiredChecks: [],
    staleChecks: [],
    failedAcceptanceCriteria: [],
    skippedAcceptanceCriteria: [],
    staleAcceptanceEvidence: [],
  };
}
