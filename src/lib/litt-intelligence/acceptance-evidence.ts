/**
 * Acceptance Evidence Model
 *
 * Structured evidence for acceptance criteria verification.
 * A criterion can become VERIFIED only from concrete runtime evidence —
 * never from model text or fabricated prose.
 *
 * Phase 9 — Studio Control Plane V1
 *
 * The chain:
 *   acceptance criteria (from plan)
 *      ↓
 *   verification attempt (evidence-backed)
 *      ↓
 *   AcceptanceEvidence[]
 *      ↓
 *   all required criteria verified?
 *      ↓
 *   deriveRunStatus()
 *      ↓
 *   READY_FOR_REVIEW
 */

export type AcceptanceStatus =
  | "queued"
  | "verifying"
  | "verified"
  | "failed"
  | "skipped";

/**
 * How a criterion was verified. Must reference concrete runtime evidence,
 * not model prose.
 */
export type VerificationSource =
  | "check_evidence" // verified by a passing CheckEvidence record
  | "mutation_evidence" // verified by a succeeded MutationEvidence record
  | "file_read_evidence" // verified by reading a file and checking content
  | "browser_evidence" // verified by browser automation
  | "deterministic_verifier" // verified by an explicit deterministic function
  | "manual_review"; // verified by explicit human review action

export interface AcceptanceEvidence {
  /** Unique acceptance evidence ID */
  id: string;
  /** The run this criterion belongs to */
  runId: string;
  /** Project ID */
  projectId: string;

  /** The criterion text from the plan/request */
  criterion: string;
  /** Whether this criterion is required for ready-for-review */
  required: boolean;
  /** Current status */
  status: AcceptanceStatus;

  /** How the criterion was (or would be) verified */
  verificationSource?: VerificationSource;
  /** References to concrete evidence records that back the verification */
  evidenceRefs: string[];
  /** Human-readable summary of what was checked (not model prose) */
  verificationSummary?: string;

  /** Why the criterion failed */
  failureReason?: string;
  /** Why the criterion was skipped */
  skipReason?: string;

  /** HEAD SHA when verification ran — proves what code was verified */
  headSha: string;
  /** Working tree diff hash when verification ran */
  workingTreeDiffHash: string;
  /** Whether this evidence is stale (code changed after verification) */
  stale: boolean;

  /** When verification started */
  startedAt: string;
  /** When verification completed */
  completedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
}

// ─── Plan Criteria (input from the plan) ─────────────────────────

export interface PlanCriterion {
  /** Criterion text — what must be true */
  criterion: string;
  /** Whether it's required for ready-for-review */
  required: boolean;
  /** How it should be verified */
  verificationSource?: VerificationSource;
  /** Optional: which check kind verifies this (for check_evidence source) */
  checkKind?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Check if acceptance evidence is stale — code changed after verification.
 * Same contract as CheckEvidence staleness.
 */
export function isAcceptanceStale(
  evidence: AcceptanceEvidence,
  currentHeadSha: string,
  currentWorkingTreeDiffHash: string,
): boolean {
  if (evidence.stale) return true;
  if (evidence.headSha !== currentHeadSha) return true;
  if (evidence.workingTreeDiffHash !== currentWorkingTreeDiffHash) return true;
  return false;
}
