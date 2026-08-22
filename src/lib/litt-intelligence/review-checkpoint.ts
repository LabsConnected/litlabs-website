/**
 * Review Checkpoint Model
 *
 * A review checkpoint freezes the exact code state being reviewed.
 * The human approves or requests changes on that specific snapshot.
 * A subsequent mutation invalidates the approval automatically.
 *
 * The invariant:
 *
 *   READY_FOR_REVIEW
 *         ↓
 *   review checkpoint captured
 *         ↓
 *   human approves exact code state
 *         ↓
 *   REVIEW_APPROVED
 *         ↓
 *   code changes?
 *     YES → approval stale / invalid
 *     NO  → eligible for Phase 11 PR draft
 *
 * Phase 10 — Studio Control Plane V1
 */

export type ReviewDecision =
  | "pending"      // checkpoint captured, awaiting human review
  | "approved"     // human approved the exact code state
  | "changes_requested" // human requested changes
  | "stale";       // code changed after checkpoint, approval invalidated

export interface ReviewCheckpoint {
  /** Unique checkpoint ID */
  id: string;
  /** The run this checkpoint belongs to */
  runId: string;
  /** Project ID */
  projectId: string;

  /** The decision: pending → approved/changes_requested, or stale */
  decision: ReviewDecision;

  /** ── Code state provenance ── */
  /** HEAD SHA when the checkpoint was captured */
  headSha: string;
  /** Working tree diff hash when the checkpoint was captured */
  workingTreeDiffHash: string;

  /** ── Snapshot references ── */
  /** Mutation evidence IDs included in this review */
  mutationEvidenceIds: string[];
  /** Check evidence IDs included in this review */
  checkEvidenceIds: string[];
  /** Acceptance evidence IDs included in this review */
  acceptanceEvidenceIds: string[];

  /** ── Reviewer ── */
  /** User ID of the reviewer (null if not yet reviewed) */
  reviewerUserId?: string;
  /** When the reviewer made their decision */
  reviewedAt?: string;
  /** Reviewer's comments (optional) */
  reviewComments?: string;

  /** ── Blockers at checkpoint time ── */
  /** Blockers that were present when the checkpoint was captured */
  blockers: string[];

  /** ── Staleness ── */
  /** Whether this checkpoint is stale (code changed after capture) */
  stale: boolean;
  /** Why the checkpoint became stale */
  staleReason?: string;

  /** When the checkpoint was captured */
  capturedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Check if a review checkpoint is stale — code changed after capture.
 * Same provenance contract as checks and acceptance evidence.
 */
export function isReviewCheckpointStale(
  checkpoint: ReviewCheckpoint,
  currentHeadSha: string,
  currentWorkingTreeDiffHash: string,
): boolean {
  if (checkpoint.stale) return true;
  if (checkpoint.headSha !== currentHeadSha) return true;
  if (checkpoint.workingTreeDiffHash !== currentWorkingTreeDiffHash) return true;
  return false;
}
