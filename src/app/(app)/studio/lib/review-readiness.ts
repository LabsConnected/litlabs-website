/**
 * Review Readiness Selector — the ONE derived presentation contract.
 *
 * This is a pure function. It derives review readiness from existing
 * authoritative sources (Phase 1–10 evidence systems) and produces
 * a read-only presentation contract for the Studio shell.
 *
 * The agent NEVER sets readiness directly. Readiness is always derived.
 *
 * Phase 10.1 — Contract freeze
 */

import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";
import type { AcceptanceEvidence } from "@/lib/litt-intelligence/acceptance-evidence";
import type { ReviewCheckpoint } from "@/lib/litt-intelligence/review-checkpoint";
import type { RunEvent } from "@/lib/litt-intelligence/run-events";
import { deriveRunStatus } from "@/lib/litt-intelligence/run-status";

// ─── Types ───────────────────────────────────────────────────────

export type ReviewReadiness =
  | "not_started"
  | "running"
  | "blocked"
  | "stale"
  | "ready_for_review"
  | "approved"
  | "changes_requested";

export interface CheckSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  running: number;
  stale: number;
  /** Required checks that haven't passed */
  failedRequired: number;
  /** Required checks that were skipped */
  skippedRequired: number;
}

export interface AcceptanceSummary {
  total: number;
  verified: number;
  failed: number;
  skipped: number;
  stale: number;
  /** Required criteria not yet verified */
  requiredPending: number;
}

export interface ChangedFilesSummary {
  added: number;
  modified: number;
  deleted: number;
  total: number;
  paths: string[];
}

export interface ProvenanceSummary {
  headSha: string;
  workingTreeDiffHash: string;
  /** Whether the code state is clean (no uncommitted changes) */
  clean: boolean;
}

export interface BlockingReason {
  category: "checks" | "acceptance" | "stale" | "approval" | "mutations" | "events";
  reason: string;
}

export interface PermittedActions {
  canCaptureCheckpoint: boolean;
  canApprove: boolean;
  canRequestChanges: boolean;
  canRunChecks: boolean;
  canStartPR: boolean;
}

export interface ReviewReadinessState {
  /** The derived readiness level */
  readiness: ReviewReadiness;
  /** Whether the run is ready for human review */
  readyForReview: boolean;
  /** Whether the run has been approved */
  reviewApproved: boolean;
  /** Whether changes were requested */
  changesRequested: boolean;
  /** Whether any evidence is stale */
  hasStaleEvidence: boolean;

  /** Code-state provenance */
  provenance: ProvenanceSummary | null;
  /** Review checkpoint (if any) */
  checkpoint: ReviewCheckpoint | null;

  /** Summarized check state */
  checks: CheckSummary;
  /** Summarized acceptance state */
  acceptance: AcceptanceSummary;
  /** Changed files */
  changes: ChangedFilesSummary;

  /** Blocking reasons (when readiness is not approved) */
  blockers: BlockingReason[];
  /** Pending approvals */
  pendingApprovals: number;

  /** What actions are permitted in this state */
  permitted: PermittedActions;

  /** Raw derivation result (for Details view) */
  derivation: ReturnType<typeof deriveRunStatus>;
}

// ─── Inputs ──────────────────────────────────────────────────────

export interface ReviewReadinessInput {
  mutationEvidence: MutationEvidence[];
  checkEvidence: CheckEvidence[];
  acceptanceEvidence: AcceptanceEvidence[];
  reviewCheckpoint: ReviewCheckpoint | null;
  runEvents: RunEvent[];
  /** Whether checks are currently running */
  checksRunning: boolean;
  /** Whether the agent is currently acting */
  isActing: boolean;
  /** Whether there are pending approvals */
  pendingApprovalCount: number;
  /** Current HEAD SHA */
  headSha: string;
  /** Current working tree diff hash */
  workingTreeDiffHash: string;
  /** Whether the working tree is clean */
  workingTreeClean: boolean;
  /** Unresolved blocking events */
  unresolvedBlockingEvents: Array<{ id: string; type: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────

function summarizeChecks(checks: CheckEvidence[]): CheckSummary {
  const required = checks.filter((c) => c.required);
  return {
    total: checks.length,
    passed: checks.filter((c) => c.status === "passed" && !c.stale).length,
    failed: checks.filter((c) => c.status === "failed" && !c.stale).length,
    skipped: checks.filter((c) => c.status === "skipped" && !c.stale).length,
    running: checks.filter((c) => c.status === "running" || c.status === "queued").length,
    stale: checks.filter((c) => c.stale).length,
    failedRequired: required.filter((c) => c.status === "failed" && !c.stale).length,
    skippedRequired: required.filter((c) => c.status === "skipped" && !c.stale).length,
  };
}

function summarizeAcceptance(acceptance: AcceptanceEvidence[]): AcceptanceSummary {
  const required = acceptance.filter((a) => a.required);
  return {
    total: acceptance.length,
    verified: acceptance.filter((a) => a.status === "verified" && !a.stale).length,
    failed: acceptance.filter((a) => a.status === "failed" && !a.stale).length,
    skipped: acceptance.filter((a) => a.status === "skipped" || a.status === "queued" || a.status === "verifying").length,
    stale: acceptance.filter((a) => a.stale).length,
    requiredPending: required.filter(
      (a) => a.status !== "verified" || a.stale,
    ).length,
  };
}

function summarizeChanges(mutations: MutationEvidence[]): ChangedFilesSummary {
  const allPaths = new Set<string>();
  let added = 0;
  let modified = 0;
  let deleted = 0;

  for (const m of mutations) {
    for (const path of m.paths) {
      allPaths.add(path);
      const before = m.beforeHashes[path];
      const after = m.afterHashes[path];
      if (!before && after) added++;
      else if (before && !after) deleted++;
      else if (before && after && before !== after) modified++;
    }
  }

  return {
    added,
    modified,
    deleted,
    total: allPaths.size,
    paths: Array.from(allPaths).sort(),
  };
}

function buildBlockers(
  derivation: ReturnType<typeof deriveRunStatus>,
  checks: CheckSummary,
  acceptance: AcceptanceSummary,
  hasStale: boolean,
  pendingApprovals: number,
  mutations: MutationEvidence[],
): BlockingReason[] {
  const blockers: BlockingReason[] = [];

  if (mutations.length === 0) {
    blockers.push({ category: "mutations", reason: "No changes have been made yet" });
  }

  if (checks.failedRequired > 0) {
    blockers.push({ category: "checks", reason: `${checks.failedRequired} required check(s) failed` });
  }
  if (checks.skippedRequired > 0) {
    blockers.push({ category: "checks", reason: `${checks.skippedRequired} required check(s) skipped` });
  }
  if (checks.stale > 0) {
    blockers.push({ category: "stale", reason: `${checks.stale} check(s) are stale` });
  }

  if (acceptance.failed > 0) {
    blockers.push({ category: "acceptance", reason: `${acceptance.failed} acceptance criterion/criteria failed` });
  }
  if (acceptance.requiredPending > 0) {
    blockers.push({ category: "acceptance", reason: `${acceptance.requiredPending} required acceptance criterion/criteria not verified` });
  }
  if (acceptance.stale > 0) {
    blockers.push({ category: "stale", reason: `${acceptance.stale} acceptance evidence record(s) stale` });
  }

  if (hasStale) {
    blockers.push({ category: "stale", reason: "Code changed after evidence was captured" });
  }

  if (pendingApprovals > 0) {
    blockers.push({ category: "approval", reason: `${pendingApprovals} pending approval(s)` });
  }

  for (const b of derivation.blockers) {
    // Add any blockers from derivation that aren't already covered
    if (!blockers.some((existing) => existing.reason === b)) {
      blockers.push({ category: "events", reason: b });
    }
  }

  return blockers;
}

function derivePermitted(
  readiness: ReviewReadiness,
  checkpoint: ReviewCheckpoint | null,
): PermittedActions {
  const hasPendingCheckpoint = checkpoint?.decision === "pending" && !checkpoint?.stale;

  return {
    canCaptureCheckpoint: readiness === "ready_for_review",
    canApprove: hasPendingCheckpoint === true,
    canRequestChanges: hasPendingCheckpoint === true,
    canRunChecks: readiness === "not_started" || readiness === "blocked" || readiness === "stale" || readiness === "changes_requested",
    // PR creation is Phase 11 — not yet permitted
    canStartPR: false,
  };
}

// ─── Main Selector ───────────────────────────────────────────────

/**
 * Derive review readiness from evidence.
 *
 * This is a PURE FUNCTION. It does not mutate state, call APIs, or
 * produce side effects. The Studio shell consumes this as a read-only
 * presentation contract.
 */
export function deriveReviewReadiness(input: ReviewReadinessInput): ReviewReadinessState {
  const {
    mutationEvidence,
    checkEvidence,
    acceptanceEvidence,
    reviewCheckpoint,
    runEvents,
    checksRunning,
    isActing,
    pendingApprovalCount,
    headSha,
    workingTreeDiffHash,
    workingTreeClean,
    unresolvedBlockingEvents,
  } = input;

  // Run the existing derivation
  const derivation = deriveRunStatus({
    mutationEvidence,
    checkEvidence,
    acceptanceEvidence,
    reviewCheckpoint,
    unresolvedBlockingEvents,
    checksRunning,
  });

  // Summarize
  const checks = summarizeChecks(checkEvidence);
  const acceptance = summarizeAcceptance(acceptanceEvidence);
  const changes = summarizeChanges(mutationEvidence);

  const hasStaleEvidence =
    checks.stale > 0 ||
    acceptance.stale > 0 ||
    (reviewCheckpoint?.stale ?? false);

  const provenance: ProvenanceSummary | null = headSha
    ? {
        headSha,
        workingTreeDiffHash,
        clean: workingTreeClean,
      }
    : null;

  // Determine readiness level
  let readiness: ReviewReadiness;

  if (isActing || checksRunning) {
    readiness = "running";
  } else if (pendingApprovalCount > 0) {
    readiness = "blocked";
  } else if (derivation.reviewApproved) {
    readiness = "approved";
  } else if (derivation.changesRequested) {
    readiness = "changes_requested";
  } else if (derivation.reviewStale) {
    readiness = "stale";
  } else if (derivation.readyForReview) {
    readiness = "ready_for_review";
  } else if (mutationEvidence.length === 0 && !isActing) {
    readiness = "not_started";
  } else {
    readiness = "blocked";
  }

  const blockers = buildBlockers(
    derivation,
    checks,
    acceptance,
    hasStaleEvidence,
    pendingApprovalCount,
    mutationEvidence,
  );

  const permitted = derivePermitted(readiness, reviewCheckpoint);

  return {
    readiness,
    readyForReview: derivation.readyForReview,
    reviewApproved: derivation.reviewApproved,
    changesRequested: derivation.changesRequested,
    hasStaleEvidence,
    provenance,
    checkpoint: reviewCheckpoint,
    checks,
    acceptance,
    changes,
    blockers,
    pendingApprovals: pendingApprovalCount,
    permitted,
    derivation,
  };
}
