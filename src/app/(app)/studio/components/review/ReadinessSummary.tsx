"use client";

import { studioColors, studioSpacing, studioTypography, type StatusTone } from "@/lib/studio/design-tokens";
import { StudioStatus } from "../primitives/StudioStatus";
import type { ReviewReadinessState } from "@/app/(app)/studio/lib/review-readiness";

/* ─────────────────────────────────────────────────────────────────
 * ReadinessSummary — top-level review readiness badge + quick stats.
 *
 * Shows the derived readiness level and a compact summary of
 * changes, checks, and acceptance status.
 *
 * Phase 10.5 — Review experience
 * ───────────────────────────────────────────────────────────────── */

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

interface ReadinessSummaryProps {
  state: ReviewReadinessState;
}

export function ReadinessSummary({ state }: ReadinessSummaryProps) {
  return (
    <div data-testid="readiness-summary" style={{
      display: "flex",
      flexDirection: "column",
      gap: studioSpacing[6],
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: studioSpacing[6],
      }}>
        <StudioStatus
          tone={readinessTone(state.readiness)}
          label={readinessLabel(state.readiness)}
          size="md"
        />
      </div>

      <div style={{
        display: "flex",
        gap: studioSpacing[12],
        fontSize: studioTypography.sm,
        flexWrap: "wrap",
      }}>
        <span style={{ color: studioColors.textSecondary }}>
          <strong style={{ color: studioColors.textPrimary }}>{state.changes.total}</strong> files
        </span>
        <span style={{ color: studioColors.textSecondary }}>
          <strong style={{ color: state.checks.failed > 0 ? studioColors.red : studioColors.textPrimary }}>
            {state.checks.passed}
          </strong>
          /{state.checks.total} checks
        </span>
        <span style={{ color: studioColors.textSecondary }}>
          <strong style={{ color: state.acceptance.requiredPending > 0 ? studioColors.amber : studioColors.textPrimary }}>
            {state.acceptance.verified}
          </strong>
          /{state.acceptance.total} criteria
        </span>
        {state.hasStaleEvidence && (
          <span style={{ color: studioColors.amber }}>
            stale evidence
          </span>
        )}
      </div>
    </div>
  );
}
