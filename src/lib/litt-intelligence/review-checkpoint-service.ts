/**
 * Review Checkpoint Service
 *
 * Captures review snapshots, records human decisions, and invalidates
 * approvals when code changes.
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

import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { WorkspaceTransport } from "./workspace-transport";
import type { MutationEvidence } from "./mutation-evidence";
import type { CheckEvidence } from "./check-evidence";
import type { AcceptanceEvidence } from "./acceptance-evidence";
import type { ReviewCheckpoint, ReviewDecision } from "./review-checkpoint";
import { isReviewCheckpointStale } from "./review-checkpoint";
import { getReviewCheckpointStore } from "./review-checkpoint-store";
import { deriveRunStatus, type DeriveRunStatusResult } from "./run-status";
import { getRunEventStore } from "./run-event-store";
import { createRunEvent } from "./run-events";

// ─── Capture Code State ──────────────────────────────────────────

async function captureCodeState(transport: WorkspaceTransport): Promise<{
  headSha: string;
  workingTreeDiffHash: string;
}> {
  let headSha = "unknown";
  try {
    const log = await transport.gitLog({ maxCount: 1 });
    headSha = log.commits[0]?.sha ?? "unknown";
  } catch { /* ok */ }

  let workingTreeDiffHash = "empty";
  try {
    const { diff } = await transport.gitDiff();
    workingTreeDiffHash = diff
      ? createHash("sha256").update(diff, "utf-8").digest("hex")
      : "empty";
  } catch { /* ok */ }

  return { headSha, workingTreeDiffHash };
}

// ─── Capture Review Checkpoint ───────────────────────────────────

export interface CaptureCheckpointInput {
  runId: string;
  projectId: string;
  transport: WorkspaceTransport;
  mutationEvidence: MutationEvidence[];
  checkEvidence: CheckEvidence[];
  acceptanceEvidence: AcceptanceEvidence[];
}

export interface CaptureCheckpointResult {
  checkpoint: ReviewCheckpoint;
  /** Whether the run was ready for review at capture time */
  ready: boolean;
  /** Derivation result at capture time */
  derivation: DeriveRunStatusResult;
}

/**
 * Capture a review checkpoint. Freezes the exact code state,
 * mutations, checks, and acceptance evidence being reviewed.
 *
 * Only captures if the run is ready_for_review. If not ready,
 * returns the blockers but does NOT create a checkpoint.
 */
export async function captureReviewCheckpoint(
  input: CaptureCheckpointInput,
): Promise<CaptureCheckpointResult> {
  const { runId, projectId, transport, mutationEvidence, checkEvidence, acceptanceEvidence } = input;
  const store = getReviewCheckpointStore();

  // Derive current status
  const derivation = deriveRunStatus({
    mutationEvidence,
    checkEvidence,
    acceptanceEvidence,
    unresolvedBlockingEvents: [],
  });

  // Only capture if ready for review
  if (!derivation.readyForReview) {
    return {
      checkpoint: {
        id: "not-captured",
        runId,
        projectId,
        decision: "pending",
        headSha: "",
        workingTreeDiffHash: "",
        mutationEvidenceIds: [],
        checkEvidenceIds: [],
        acceptanceEvidenceIds: [],
        blockers: derivation.blockers,
        stale: false,
        capturedAt: new Date().toISOString(),
      },
      ready: false,
      derivation,
    };
  }

  // Capture code state
  const codeState = await captureCodeState(transport);

  const checkpoint: ReviewCheckpoint = {
    id: randomUUID(),
    runId,
    projectId,
    decision: "pending",
    headSha: codeState.headSha,
    workingTreeDiffHash: codeState.workingTreeDiffHash,
    mutationEvidenceIds: mutationEvidence.map((m) => m.id),
    checkEvidenceIds: checkEvidence.map((c) => c.id),
    acceptanceEvidenceIds: acceptanceEvidence.map((a) => a.id),
    blockers: derivation.blockers,
    stale: false,
    capturedAt: new Date().toISOString(),
  };

  await store.insert(checkpoint);

  // Emit event
  const runEventStore = getRunEventStore();
  await runEventStore.insert(createRunEvent(runId, projectId, "checkpoint_captured", {
    checkpointId: checkpoint.id,
    headSha: checkpoint.headSha,
  }));

  return { checkpoint, ready: true, derivation };
}

// ─── Approve ─────────────────────────────────────────────────────

export interface ApproveInput {
  checkpointId: string;
  reviewerUserId: string;
  reviewComments?: string;
}

/**
 * Approve a review checkpoint. The reviewer is approving the exact
 * code state captured in the checkpoint.
 *
 * If the checkpoint is stale (code changed after capture), the
 * approval is rejected.
 */
export async function approveReviewCheckpoint(
  input: ApproveInput,
): Promise<{ checkpoint: ReviewCheckpoint; approved: boolean; reason?: string }> {
  const store = getReviewCheckpointStore();
  const checkpoint = await store.getById(input.checkpointId);

  if (!checkpoint) {
    return { checkpoint: null as never, approved: false, reason: "Checkpoint not found" };
  }

  if (checkpoint.stale) {
    return {
      checkpoint,
      approved: false,
      reason: `Checkpoint is stale: ${checkpoint.staleReason ?? "code changed after capture"}`,
    };
  }

  if (checkpoint.decision !== "pending") {
    return {
      checkpoint,
      approved: false,
      reason: `Checkpoint already has decision: ${checkpoint.decision}`,
    };
  }

  const reviewedAt = new Date().toISOString();
  await store.update(input.checkpointId, {
    decision: "approved",
    reviewerUserId: input.reviewerUserId,
    reviewedAt,
    reviewComments: input.reviewComments,
  });

  // Emit event
  const runEventStore = getRunEventStore();
  await runEventStore.insert(createRunEvent(checkpoint.runId, checkpoint.projectId, "review_approved", {
    checkpointId: checkpoint.id,
    reviewerUserId: input.reviewerUserId,
  }));

  const updated = await store.getById(input.checkpointId);
  return { checkpoint: updated!, approved: true };
}

// ─── Request Changes ─────────────────────────────────────────────

export interface RequestChangesInput {
  checkpointId: string;
  reviewerUserId: string;
  reviewComments?: string;
}

/**
 * Request changes on a review checkpoint. The reviewer is rejecting
 * the current code state and requesting modifications.
 */
export async function requestChangesOnCheckpoint(
  input: RequestChangesInput,
): Promise<{ checkpoint: ReviewCheckpoint; recorded: boolean; reason?: string }> {
  const store = getReviewCheckpointStore();
  const checkpoint = await store.getById(input.checkpointId);

  if (!checkpoint) {
    return { checkpoint: null as never, recorded: false, reason: "Checkpoint not found" };
  }

  if (checkpoint.stale) {
    return {
      checkpoint,
      recorded: false,
      reason: `Checkpoint is stale: ${checkpoint.staleReason ?? "code changed after capture"}`,
    };
  }

  if (checkpoint.decision !== "pending") {
    return {
      checkpoint,
      recorded: false,
      reason: `Checkpoint already has decision: ${checkpoint.decision}`,
    };
  }

  const reviewedAt = new Date().toISOString();
  await store.update(input.checkpointId, {
    decision: "changes_requested",
    reviewerUserId: input.reviewerUserId,
    reviewedAt,
    reviewComments: input.reviewComments,
  });

  // Emit event
  const runEventStore = getRunEventStore();
  await runEventStore.insert(createRunEvent(checkpoint.runId, checkpoint.projectId, "changes_requested", {
    checkpointId: checkpoint.id,
    reviewerUserId: input.reviewerUserId,
  }));

  const updated = await store.getById(input.checkpointId);
  return { checkpoint: updated!, recorded: true };
}

// ─── Invalidate Stale Checkpoints ────────────────────────────────

/**
 * Invalidate all review checkpoints for a run when code changes.
 * Called after a new mutation occurs.
 *
 * An approved checkpoint becomes stale — the approval no longer
 * applies to the current code state.
 */
export async function invalidateStaleReviewCheckpoints(
  runId: string,
  currentHeadSha: string,
  currentWorkingTreeDiffHash: string,
): Promise<void> {
  const store = getReviewCheckpointStore();
  const checkpoints = await store.listByRun(runId);

  for (const checkpoint of checkpoints) {
    if (isReviewCheckpointStale(checkpoint, currentHeadSha, currentWorkingTreeDiffHash)) {
      const reason = `Code changed after checkpoint (headSha: ${checkpoint.headSha.slice(0, 8)} → ${currentHeadSha.slice(0, 8)}, diffHash: ${checkpoint.workingTreeDiffHash.slice(0, 8)} → ${currentWorkingTreeDiffHash.slice(0, 8)})`;
      await store.update(checkpoint.id, {
        stale: true,
        staleReason: reason,
        decision: "stale" as ReviewDecision,
      });
    }
  }
}

// ─── Get Review State ────────────────────────────────────────────

export interface ReviewState {
  /** The latest checkpoint for the run, if any */
  latestCheckpoint: ReviewCheckpoint | null;
  /** Whether the run has an active (non-stale) approved checkpoint */
  reviewApproved: boolean;
  /** Whether the run has an active (non-stale) changes_requested checkpoint */
  changesRequested: boolean;
  /** Whether any checkpoint is stale */
  hasStaleCheckpoint: boolean;
}

/**
 * Get the current review state for a run.
 */
export async function getReviewState(runId: string): Promise<ReviewState> {
  const store = getReviewCheckpointStore();
  const latest = await store.getLatestForRun(runId);

  if (!latest) {
    return {
      latestCheckpoint: null,
      reviewApproved: false,
      changesRequested: false,
      hasStaleCheckpoint: false,
    };
  }

  return {
    latestCheckpoint: latest,
    reviewApproved: latest.decision === "approved" && !latest.stale,
    changesRequested: latest.decision === "changes_requested" && !latest.stale,
    hasStaleCheckpoint: latest.stale,
  };
}
