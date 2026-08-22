"use client";

import { studioColors, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";
import type { ProvenanceSummary } from "@/app/(app)/studio/lib/review-readiness";

/* ─────────────────────────────────────────────────────────────────
 * ProvenanceSummary — shows the exact code state being reviewed.
 *
 * Approval must submit the exact provenance identifier displayed
 * here. This is the binding between human approval and code state.
 *
 * Phase 10.5 — Review experience
 * ───────────────────────────────────────────────────────────────── */

interface ProvenanceSummaryProps {
  provenance: ProvenanceSummary | null;
}

export function ProvenanceSummary({ provenance }: ProvenanceSummaryProps) {
  if (!provenance) {
    return (
      <div data-testid="provenance-summary" style={{
        fontSize: studioTypography.sm,
        color: studioColors.textMuted,
      }}>
        No code state available
      </div>
    );
  }

  return (
    <div data-testid="provenance-summary" style={{
      display: "flex",
      flexDirection: "column",
      gap: studioSpacing[2],
      fontSize: studioTypography.sm,
      fontFamily: studioTypography.mono,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: studioSpacing[4],
      }}>
        <span style={{
          color: studioColors.textMuted,
          fontSize: studioTypography.xs,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          minWidth: 48,
        }}>
          SHA
        </span>
        <span style={{ color: studioColors.textPrimary }}>
          {provenance.headSha.slice(0, 12)}
        </span>
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: studioSpacing[4],
      }}>
        <span style={{
          color: studioColors.textMuted,
          fontSize: studioTypography.xs,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          minWidth: 48,
        }}>
          Diff
        </span>
        <span style={{ color: studioColors.textPrimary }}>
          {provenance.workingTreeDiffHash.slice(0, 12)}
        </span>
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: studioSpacing[4],
      }}>
        <span style={{
          color: studioColors.textMuted,
          fontSize: studioTypography.xs,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          minWidth: 48,
        }}>
          Tree
        </span>
        <span style={{
          color: provenance.clean ? studioColors.green : studioColors.amber,
        }}>
          {provenance.clean ? "clean" : "uncommitted changes"}
        </span>
      </div>
    </div>
  );
}
