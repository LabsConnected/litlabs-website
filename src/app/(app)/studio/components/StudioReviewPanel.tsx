"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  GitCommit,
  FileCode,
  ShieldCheck,
} from "lucide-react";
import type { ReviewCheckpoint, ReviewDecision } from "@/lib/litt-intelligence/review-checkpoint";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";

/* ─────────────────────────────────────────────────────────────────
 * StudioReviewPanel — renders the review checkpoint surface.
 *
 * Shows:
 * - Current review state (pending / approved / changes_requested / stale)
 * - The exact code state being reviewed (headSha + diffHash)
 * - Mutations included in the review
 * - Blockers when ready_for_review=false
 * - Approve / Request changes actions
 * - Stale state with reason
 *
 * Phase 10 — Studio Control Plane V1
 * ───────────────────────────────────────────────────────────────── */

interface StudioReviewPanelProps {
  /** Latest review checkpoint (null if none captured) */
  checkpoint: ReviewCheckpoint | null;
  /** Mutations being reviewed */
  mutations: MutationEvidence[];
  /** Whether the run is ready for review (from deriveRunStatus) */
  readyForReview: boolean;
  /** Blockers when not ready */
  blockers: string[];
  /** Loading state */
  loading: boolean;
  /** Approve callback */
  onApprove?: (comments?: string) => void;
  /** Request changes callback */
  onRequestChanges?: (comments?: string) => void;
  /** Whether an action is in progress */
  actionInProgress?: boolean;
}

function DecisionIcon({ decision }: { decision: ReviewDecision }) {
  switch (decision) {
    case "approved":
      return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    case "changes_requested":
      return <XCircle className="h-4 w-4 text-amber-400" />;
    case "stale":
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "pending":
      return <Clock className="h-4 w-4 text-violet-400" />;
  }
}

const DECISION_LABELS: Record<ReviewDecision, string> = {
  approved: "Approved",
  changes_requested: "Changes Requested",
  stale: "Stale — Re-review Needed",
  pending: "Awaiting Review",
};

export function StudioReviewPanel({
  checkpoint,
  mutations,
  readyForReview,
  blockers,
  loading,
  onApprove,
  onRequestChanges,
  actionInProgress,
}: StudioReviewPanelProps) {
  const sortedMutations = useMemo(
    () =>
      [...mutations].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
    [mutations],
  );

  if (loading && !checkpoint) {
    return (
      <div className="flex items-center justify-center py-8 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Loading review state…
      </div>
    );
  }

  // No checkpoint yet
  if (!checkpoint) {
    if (!readyForReview) {
      // Show blockers
      return (
        <div className="space-y-2" data-testid="studio-review-panel">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] font-bold text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Not ready for review
            </div>
            {blockers.length > 0 ? (
              <ul className="mt-1.5 space-y-1 text-[9px]" style={{ color: "var(--text-secondary)" }} data-testid="review-blockers">
                {blockers.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-amber-400">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
                Resolve blockers to enable review.
              </div>
            )}
          </div>
        </div>
      );
    }

    // Ready but no checkpoint captured yet
    return (
      <div className="space-y-2" data-testid="studio-review-panel">
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          <div className="flex items-center gap-2 text-[10px] font-bold text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Ready for review
          </div>
          <div className="mt-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
            All checks passed, acceptance criteria verified. Capture a review checkpoint to begin.
          </div>
        </div>
      </div>
    );
  }

  // Checkpoint exists
  return (
    <div className="space-y-2" data-testid="studio-review-panel">
      {/* Decision header */}
      <div
        className="rounded-lg border px-3 py-2"
        style={{
          borderColor: checkpoint.stale ? "rgba(251,146,60,0.3)" : "var(--studio-border)",
          backgroundColor: checkpoint.stale ? "rgba(251,146,60,0.04)" : "var(--studio-card)",
        }}
        data-testid="review-checkpoint"
      >
        <div className="flex items-center gap-2">
          <DecisionIcon decision={checkpoint.decision} />
          <span className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }} data-testid="review-decision">
            {DECISION_LABELS[checkpoint.decision]}
          </span>
          {checkpoint.stale && (
            <span className="text-[8px] uppercase tracking-wider text-amber-400" data-testid="review-stale-badge">
              STALE
            </span>
          )}
        </div>

        {/* Stale reason */}
        {checkpoint.stale && checkpoint.staleReason && (
          <div className="mt-1.5 text-[9px] text-amber-400" data-testid="review-stale-reason">
            {checkpoint.staleReason}
          </div>
        )}

        {/* Reviewer info */}
        {checkpoint.reviewerUserId && (
          <div className="mt-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
            by <span className="font-mono">{checkpoint.reviewerUserId.slice(0, 12)}</span>
            {checkpoint.reviewedAt && ` · ${new Date(checkpoint.reviewedAt).toLocaleString()}`}
          </div>
        )}

        {/* Review comments */}
        {checkpoint.reviewComments && (
          <div className="mt-1 text-[9px]" style={{ color: "var(--text-secondary)" }} data-testid="review-comments">
            "{checkpoint.reviewComments}"
          </div>
        )}
      </div>

      {/* Code state provenance */}
      <div className="rounded-lg border px-2.5 py-2 text-[9px]" style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }} data-testid="review-code-state">
        <div className="flex items-center gap-1.5 mb-1">
          <GitCommit className="h-3 w-3" />
          <span className="font-bold">Code state under review</span>
        </div>
        <div className="flex justify-between">
          <span>HEAD</span>
          <span className="font-mono">{checkpoint.headSha.slice(0, 12)}</span>
        </div>
        <div className="flex justify-between">
          <span>Worktree</span>
          <span className="font-mono">{checkpoint.workingTreeDiffHash.slice(0, 12)}</span>
        </div>
      </div>

      {/* Mutations included */}
      {sortedMutations.length > 0 && (
        <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)" }} data-testid="review-mutations">
          <div className="flex items-center gap-1.5 mb-1 text-[9px] font-bold" style={{ color: "var(--text-muted)" }}>
            <FileCode className="h-3 w-3" />
            Mutations ({sortedMutations.length})
          </div>
          {sortedMutations.map((m) => (
            <div key={m.id} className="text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>
              {m.paths.join(", ")}
            </div>
          ))}
        </div>
      )}

      {/* Evidence counts */}
      <div className="rounded-lg border px-2.5 py-2 text-[9px]" style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }} data-testid="review-evidence-counts">
        <div className="flex items-center gap-1.5 mb-1">
          <ShieldCheck className="h-3 w-3" />
          <span className="font-bold">Evidence included</span>
        </div>
        <div className="flex justify-between">
          <span>Checks</span>
          <span className="font-mono">{checkpoint.checkEvidenceIds.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Acceptance</span>
          <span className="font-mono">{checkpoint.acceptanceEvidenceIds.length}</span>
        </div>
      </div>

      {/* Actions — only show when pending and not stale */}
      {checkpoint.decision === "pending" && !checkpoint.stale && onApprove && onRequestChanges && (
        <div className="flex gap-2" data-testid="review-actions">
          <button
            onClick={() => onApprove()}
            disabled={actionInProgress}
            className="flex-1 rounded-md bg-green-500/10 px-3 py-1.5 text-[10px] font-bold text-green-400 transition hover:bg-green-500/20 disabled:opacity-50"
            data-testid="review-approve-btn"
          >
            {actionInProgress ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : "Approve"}
          </button>
          <button
            onClick={() => onRequestChanges()}
            disabled={actionInProgress}
            className="flex-1 rounded-md bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold text-amber-400 transition hover:bg-amber-500/20 disabled:opacity-50"
            data-testid="review-request-changes-btn"
          >
            {actionInProgress ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : "Request Changes"}
          </button>
        </div>
      )}
    </div>
  );
}
