"use client";

import { type ReactNode } from "react";
import { studioColors, studioSpacing, studioTypography, type StatusTone } from "@/lib/studio/design-tokens";
import { StudioPanel } from "../primitives/StudioPanel";
import { StudioStatus } from "../primitives/StudioStatus";
import { StudioButton } from "../primitives/StudioButton";
import { StudioDisclosure } from "../primitives/StudioDisclosure";
import { StudioEmptyState } from "../primitives/StudioEmptyState";
import type { ReviewReadinessState } from "@/app/(app)/studio/lib/review-readiness";

/* ─────────────────────────────────────────────────────────────────
 * ReviewPanel — Inspector tab: Review.
 *
 * Combines Plan, Activity, Changes, Checks, and Acceptance into
 * a single review decision. Shows readiness summary, blocking
 * reasons, provenance, and Approve/Request Changes actions.
 *
 * Approval submits the exact provenance identifier displayed.
 *
 * Phase 10.4 — Inspector consolidation
 * ───────────────────────────────────────────────────────────────── */

interface ReviewPanelProps {
  state: ReviewReadinessState;
  loading?: boolean;
  onApprove?: () => void;
  onRequestChanges?: (comment: string) => void;
  onCaptureCheckpoint?: () => void;
}

function readinessTone(readiness: ReviewReadinessState["readiness"]): StatusTone {
  switch (readiness) {
    case "approved": return "success";
    case "ready_for_review": return "violet";
    case "changes_requested": return "warning";
    case "stale": return "warning";
    case "blocked": return "error";
    case "running": return "info";
    case "not_started":
    default: return "idle";
  }
}

function readinessLabel(readiness: ReviewReadinessState["readiness"]): string {
  switch (readiness) {
    case "approved": return "Approved";
    case "ready_for_review": return "Ready for Review";
    case "changes_requested": return "Changes Requested";
    case "stale": return "Stale — Re-review Needed";
    case "blocked": return "Blocked";
    case "running": return "Running";
    case "not_started": return "Not Started";
  }
}

export function ReviewPanel({
  state,
  loading,
  onApprove,
  onRequestChanges,
  onCaptureCheckpoint,
}: ReviewPanelProps) {
  if (loading) {
    return <div style={{ padding: studioSpacing[8] }} data-testid="review-panel-loading">Loading review…</div>;
  }

  if (state.readiness === "not_started" && state.changes.total === 0) {
    return (
      <StudioEmptyState
        title="Nothing to review yet"
        description="When LiTT makes changes and checks pass, the review summary will appear here."
        testId="review-panel-empty"
      />
    );
  }

  const canApprove = state.permitted.canApprove;
  const canRequestChanges = state.permitted.canRequestChanges;
  const canCapture = state.permitted.canCaptureCheckpoint;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[6] }} data-testid="review-panel">
      {/* Readiness summary */}
      <StudioPanel title="Review Status" testId="review-status-panel">
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: studioSpacing[6],
          marginBottom: studioSpacing[6],
        }}>
          <StudioStatus
            tone={readinessTone(state.readiness)}
            label={readinessLabel(state.readiness)}
            size="md"
          />
        </div>

        {/* Quick stats */}
        <div style={{
          display: "flex",
          gap: studioSpacing[12],
          fontSize: studioTypography.sm,
          flexWrap: "wrap",
        }}>
          <span style={{ color: studioColors.textSecondary }}>
            <strong style={{ color: studioColors.textPrimary }}>{state.changes.total}</strong> files changed
          </span>
          <span style={{ color: studioColors.textSecondary }}>
            <strong style={{ color: state.checks.failed > 0 ? studioColors.red : studioColors.textPrimary }}>{state.checks.passed}</strong>/{state.checks.total} checks passed
          </span>
          <span style={{ color: studioColors.textSecondary }}>
            <strong style={{ color: state.acceptance.requiredPending > 0 ? studioColors.amber : studioColors.textPrimary }}>{state.acceptance.verified}</strong>/{state.acceptance.total} criteria verified
          </span>
        </div>
      </StudioPanel>

      {/* Provenance */}
      {state.provenance && (
        <StudioPanel title="Code State" testId="review-provenance-panel">
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: studioSpacing[2],
            fontSize: studioTypography.sm,
            fontFamily: studioTypography.mono,
          }}>
            <div>
              <span style={{ color: studioColors.textMuted }}>SHA: </span>
              <span style={{ color: studioColors.textPrimary }}>{state.provenance.headSha.slice(0, 12)}</span>
            </div>
            <div>
              <span style={{ color: studioColors.textMuted }}>Diff: </span>
              <span style={{ color: studioColors.textPrimary }}>{state.provenance.workingTreeDiffHash.slice(0, 12)}</span>
            </div>
            <div>
              <span style={{ color: studioColors.textMuted }}>Clean: </span>
              <span style={{ color: state.provenance.clean ? studioColors.green : studioColors.amber }}>
                {state.provenance.clean ? "yes" : "no (uncommitted changes)"}
              </span>
            </div>
          </div>
        </StudioPanel>
      )}

      {/* Checkpoint state */}
      {state.checkpoint && (
        <StudioPanel title="Checkpoint" testId="review-checkpoint-panel">
          <div style={{
            fontSize: studioTypography.sm,
            color: studioColors.textSecondary,
            lineHeight: 1.4,
          }}>
            <div>Decision: <strong style={{
              color: state.checkpoint.decision === "approved" ? studioColors.green :
                     state.checkpoint.decision === "changes_requested" ? studioColors.amber :
                     state.checkpoint.decision === "stale" ? studioColors.amber :
                     studioColors.textPrimary
            }}>{state.checkpoint.decision}</strong></div>
            {state.checkpoint.reviewerUserId && (
              <div style={{ marginTop: studioSpacing[2] }}>
                Reviewer: {state.checkpoint.reviewerUserId}
              </div>
            )}
            {state.checkpoint.reviewedAt && (
              <div style={{ marginTop: studioSpacing[2] }}>
                Reviewed: {new Date(state.checkpoint.reviewedAt).toLocaleString()}
              </div>
            )}
            {state.checkpoint.reviewComments && (
              <div style={{ marginTop: studioSpacing[4], color: studioColors.textMuted }}>
                "{state.checkpoint.reviewComments}"
              </div>
            )}
            {state.checkpoint.stale && state.checkpoint.staleReason && (
              <div style={{
                marginTop: studioSpacing[4],
                padding: studioSpacing[4],
                borderRadius: "4px",
                background: studioColors.amberSoft,
                color: studioColors.amber,
                fontSize: studioTypography.sm,
              }}>
                ⚠ {state.checkpoint.staleReason}
              </div>
            )}
          </div>
        </StudioPanel>
      )}

      {/* Blocking reasons */}
      {state.blockers.length > 0 && state.readiness !== "approved" && (
        <StudioPanel
          title={`Blocking Reasons (${state.blockers.length})`}
          tone={state.readiness === "blocked" ? "error" : "warning"}
          testId="review-blockers-panel"
        >
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {state.blockers.map((blocker, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: studioSpacing[4],
                  padding: `${studioSpacing[2]} 0`,
                  fontSize: studioTypography.md,
                  color: studioColors.textSecondary,
                  borderBottom: i < state.blockers.length - 1 ? `1px solid ${studioColors.borderNeutral}` : "none",
                }}
              >
                <span style={{
                  color: blocker.category === "checks" || blocker.category === "acceptance" ? studioColors.red :
                         blocker.category === "stale" ? studioColors.amber :
                         blocker.category === "approval" ? studioColors.amber :
                         studioColors.textMuted,
                  flexShrink: 0,
                  fontSize: studioTypography.sm,
                }}>
                  ⚠
                </span>
                <span>{blocker.reason}</span>
              </li>
            ))}
          </ul>
        </StudioPanel>
      )}

      {/* Actions */}
      <div
        style={{
          display: "flex",
          gap: studioSpacing[4],
          padding: studioSpacing[6],
          borderRadius: "8px",
          background: studioColors.card,
          border: `1px solid ${studioColors.borderNeutral}`,
        }}
        data-testid="review-actions"
      >
        {canCapture && onCaptureCheckpoint && (
          <StudioButton
            variant="primary"
            size="md"
            onClick={onCaptureCheckpoint}
            data-testid="review-capture-btn"
          >
            Capture Checkpoint
          </StudioButton>
        )}
        {canApprove && onApprove && (
          <StudioButton
            variant="primary"
            size="md"
            onClick={onApprove}
            data-testid="review-approve-btn"
          >
            Approve
          </StudioButton>
        )}
        {canRequestChanges && onRequestChanges && (
          <StudioButton
            variant="secondary"
            size="md"
            onClick={() => onRequestChanges("")}
            data-testid="review-request-changes-btn"
          >
            Request Changes
          </StudioButton>
        )}
      </div>

      {/* Raw evidence under Details */}
      <StudioDisclosure label="Raw Evidence" testId="review-raw-evidence">
        <div style={{
          fontSize: studioTypography.xs,
          color: studioColors.textMuted,
          fontFamily: studioTypography.mono,
          lineHeight: 1.6,
        }}>
          <div>Readiness: {state.readiness}</div>
          <div>Ready for review: {String(state.readyForReview)}</div>
          <div>Review approved: {String(state.reviewApproved)}</div>
          <div>Changes requested: {String(state.changesRequested)}</div>
          <div>Has stale evidence: {String(state.hasStaleEvidence)}</div>
          <div>Checks: {state.checks.passed}/{state.checks.total} passed, {state.checks.failed} failed, {state.checks.stale} stale</div>
          <div>Acceptance: {state.acceptance.verified}/{state.acceptance.total} verified, {state.acceptance.stale} stale</div>
          <div>Changes: {state.changes.added} added, {state.changes.modified} modified, {state.changes.deleted} deleted</div>
          <div>Pending approvals: {state.pendingApprovals}</div>
          <div>canCaptureCheckpoint: {String(state.permitted.canCaptureCheckpoint)}</div>
          <div>canApprove: {String(state.permitted.canApprove)}</div>
          <div>canRequestChanges: {String(state.permitted.canRequestChanges)}</div>
          <div>canStartPR: {String(state.permitted.canStartPR)}</div>
        </div>
      </StudioDisclosure>
    </div>
  );
}
