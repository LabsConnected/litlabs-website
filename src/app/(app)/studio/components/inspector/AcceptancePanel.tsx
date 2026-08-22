"use client";

import { studioColors, studioSpacing, studioTypography, type StatusTone } from "@/lib/studio/design-tokens";
import { StudioPanel } from "../primitives/StudioPanel";
import { StudioStatus } from "../primitives/StudioStatus";
import { StudioEmptyState } from "../primitives/StudioEmptyState";
import type { AcceptanceSummary } from "@/app/(app)/studio/lib/review-readiness";
import type { AcceptanceEvidence } from "@/lib/litt-intelligence/acceptance-evidence";

/* ─────────────────────────────────────────────────────────────────
 * AcceptancePanel — Inspector tab: Acceptance.
 *
 * Explains requirement coverage. Shows acceptance criteria with
 * verification status, evidence references, and stale state.
 *
 * Phase 10.4 — Inspector consolidation
 * ───────────────────────────────────────────────────────────────── */

interface AcceptancePanelProps {
  summary: AcceptanceSummary;
  evidence: AcceptanceEvidence[];
  loading?: boolean;
}

function acceptanceTone(item: AcceptanceEvidence): StatusTone {
  if (item.stale) return "warning";
  if (item.status === "verified") return "success";
  if (item.status === "failed") return "error";
  if (item.status === "skipped") return "idle";
  return "info";
}

function acceptanceLabel(item: AcceptanceEvidence): string {
  if (item.stale) return "stale";
  return item.status;
}

export function AcceptancePanel({ summary, evidence, loading }: AcceptancePanelProps) {
  if (loading) {
    return <div style={{ padding: studioSpacing[8] }} data-testid="acceptance-panel-loading">Loading acceptance…</div>;
  }

  if (evidence.length === 0) {
    return (
      <StudioEmptyState
        title="No acceptance criteria"
        description="When a plan includes acceptance criteria, verification results will appear here."
        testId="acceptance-panel-empty"
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[6] }} data-testid="acceptance-panel">
      <StudioPanel title="Summary" testId="acceptance-summary-panel">
        <div style={{
          display: "flex",
          gap: studioSpacing[8],
          fontSize: studioTypography.md,
          flexWrap: "wrap",
        }}>
          <span style={{ color: studioColors.green }}>{summary.verified} verified</span>
          <span style={{ color: studioColors.red }}>{summary.failed} failed</span>
          <span style={{ color: studioColors.gray }}>{summary.skipped} pending</span>
          {summary.stale > 0 && (
            <span style={{ color: studioColors.amber }}>{summary.stale} stale</span>
          )}
        </div>
        {summary.requiredPending > 0 && (
          <div style={{
            marginTop: studioSpacing[4],
            fontSize: studioTypography.sm,
            color: studioColors.amber,
          }}>
            {summary.requiredPending} required criterion/criteria not yet verified
          </div>
        )}
      </StudioPanel>

      <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[2] }}>
        {evidence.map((item) => (
          <div
            key={item.id}
            style={{
              padding: studioSpacing[6],
              borderRadius: "8px",
              background: studioColors.card,
              border: `1px solid ${studioColors.borderNeutral}`,
            }}
            data-testid={`acceptance-item-${item.id}`}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: studioSpacing[4],
            }}>
              <StudioStatus
                tone={acceptanceTone(item)}
                label={acceptanceLabel(item)}
                size="sm"
              />
              {item.required && (
                <span style={{
                  fontSize: studioTypography.xs,
                  color: studioColors.textMuted,
                  fontWeight: 600,
                }}>
                  REQUIRED
                </span>
              )}
            </div>
            <div style={{
              fontSize: studioTypography.md,
              color: studioColors.textPrimary,
              lineHeight: 1.4,
              marginBottom: studioSpacing[4],
            }}>
              {item.criterion}
            </div>
            {item.verificationSummary && (
              <div style={{
                fontSize: studioTypography.sm,
                color: studioColors.textMuted,
                lineHeight: 1.4,
              }}>
                {item.verificationSummary}
              </div>
            )}
            {item.failureReason && (
              <div style={{
                marginTop: studioSpacing[4],
                fontSize: studioTypography.sm,
                color: studioColors.red,
              }}>
                {item.failureReason}
              </div>
            )}
            {item.evidenceRefs.length > 0 && (
              <div style={{
                marginTop: studioSpacing[4],
                fontSize: studioTypography.xs,
                color: studioColors.textMuted,
                fontFamily: studioTypography.mono,
              }}>
                Evidence: {item.evidenceRefs.join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
