"use client";

import { studioColors, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";
import { StudioButton } from "../primitives/StudioButton";
import type { PermittedActions } from "@/app/(app)/studio/lib/review-readiness";

/* ─────────────────────────────────────────────────────────────────
 * ReviewActionBar — Approve / Request Changes / Capture Checkpoint.
 *
 * Only shows actions that are permitted in the current state.
 * Approval submits the exact provenance identifier displayed
 * in the ProvenanceSummary.
 *
 * Phase 10.5 — Review experience
 * ───────────────────────────────────────────────────────────────── */

interface ReviewActionBarProps {
  permitted: PermittedActions;
  onApprove?: () => void;
  onRequestChanges?: (comment: string) => void;
  onCaptureCheckpoint?: () => void;
  approving?: boolean;
}

export function ReviewActionBar({
  permitted,
  onApprove,
  onRequestChanges,
  onCaptureCheckpoint,
  approving,
}: ReviewActionBarProps) {
  const hasActions = permitted.canApprove || permitted.canRequestChanges || permitted.canCaptureCheckpoint;

  if (!hasActions) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: studioSpacing[4],
        padding: studioSpacing[6],
        borderRadius: "8px",
        background: studioColors.card,
        border: `1px solid ${studioColors.borderNeutral}`,
      }}
      data-testid="review-action-bar"
    >
      {permitted.canCaptureCheckpoint && onCaptureCheckpoint && (
        <StudioButton
          variant="primary"
          size="md"
          onClick={onCaptureCheckpoint}
          data-testid="action-capture-checkpoint"
        >
          Capture Checkpoint
        </StudioButton>
      )}
      {permitted.canApprove && onApprove && (
        <StudioButton
          variant="primary"
          size="md"
          onClick={onApprove}
          loading={approving}
          data-testid="action-approve"
        >
          Approve
        </StudioButton>
      )}
      {permitted.canRequestChanges && onRequestChanges && (
        <StudioButton
          variant="secondary"
          size="md"
          onClick={() => onRequestChanges("")}
          data-testid="action-request-changes"
        >
          Request Changes
        </StudioButton>
      )}
    </div>
  );
}
