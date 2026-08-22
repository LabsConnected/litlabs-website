"use client";

import { studioColors, studioSpacing, studioTypography, type StatusTone } from "@/lib/studio/design-tokens";
import { StudioPanel } from "../primitives/StudioPanel";
import { StudioStatus } from "../primitives/StudioStatus";
import { StudioDisclosure } from "../primitives/StudioDisclosure";
import { StudioEmptyState } from "../primitives/StudioEmptyState";
import type { CheckSummary } from "@/app/(app)/studio/lib/review-readiness";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";

/* ─────────────────────────────────────────────────────────────────
 * ChecksPanel — Inspector tab: Checks.
 *
 * Explains automated validation. Shows check summary and per-check
 * status with output under Details.
 *
 * Phase 10.4 — Inspector consolidation
 * ───────────────────────────────────────────────────────────────── */

interface ChecksPanelProps {
  summary: CheckSummary;
  checks: CheckEvidence[];
  loading?: boolean;
  onRerun?: (checkId: string) => void;
  onRunAll?: () => void;
}

function checkTone(check: CheckEvidence): StatusTone {
  if (check.stale) return "warning";
  if (check.status === "passed") return "success";
  if (check.status === "failed") return "error";
  if (check.status === "running" || check.status === "queued") return "info";
  if (check.status === "skipped") return "idle";
  return "idle";
}

function checkLabel(check: CheckEvidence): string {
  if (check.stale) return `${check.kind} (stale)`;
  return `${check.kind} — ${check.status}`;
}

export function ChecksPanel({ summary, checks, loading, onRerun, onRunAll }: ChecksPanelProps) {
  if (loading) {
    return <div style={{ padding: studioSpacing[8] }} data-testid="checks-panel-loading">Loading checks…</div>;
  }

  if (checks.length === 0) {
    return (
      <StudioEmptyState
        title="No checks yet"
        description="Run checks to verify typecheck, tests, build, and browser validation."
        testId="checks-panel-empty"
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[6] }} data-testid="checks-panel">
      <StudioPanel
        title="Summary"
        actions={onRunAll && (
          <button
            onClick={onRunAll}
            style={{
              background: "transparent",
              border: `1px solid ${studioColors.border}`,
              color: studioColors.textSecondary,
              fontSize: studioTypography.xs,
              padding: `${studioSpacing[1]} ${studioSpacing[4]}`,
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            data-testid="checks-run-all"
          >
            Run All
          </button>
        )}
        testId="checks-summary-panel"
      >
        <div style={{
          display: "flex",
          gap: studioSpacing[8],
          fontSize: studioTypography.md,
          flexWrap: "wrap",
        }}>
          <span style={{ color: studioColors.green }}>{summary.passed} passed</span>
          <span style={{ color: studioColors.red }}>{summary.failed} failed</span>
          <span style={{ color: studioColors.gray }}>{summary.skipped} skipped</span>
          {summary.running > 0 && (
            <span style={{ color: studioColors.blue }}>{summary.running} running</span>
          )}
          {summary.stale > 0 && (
            <span style={{ color: studioColors.amber }}>{summary.stale} stale</span>
          )}
        </div>
      </StudioPanel>

      <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[2] }}>
        {checks.map((check) => (
          <div
            key={check.id}
            style={{
              padding: studioSpacing[6],
              borderRadius: "8px",
              background: studioColors.card,
              border: `1px solid ${studioColors.borderNeutral}`,
            }}
            data-testid={`check-item-${check.kind}`}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <StudioStatus
                tone={checkTone(check)}
                label={checkLabel(check)}
                size="sm"
              />
              <div style={{ display: "flex", gap: studioSpacing[4] }}>
                {check.durationMs !== undefined && check.status === "passed" && (
                  <span style={{
                    fontSize: studioTypography.xs,
                    color: studioColors.textMuted,
                  }}>
                    {(check.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
                {onRerun && !check.stale && check.status !== "running" && (
                  <button
                    onClick={() => onRerun(check.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: studioColors.textMuted,
                      fontSize: studioTypography.xs,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    data-testid={`check-rerun-${check.kind}`}
                  >
                    ↻ Rerun
                  </button>
                )}
              </div>
            </div>
            {(check.failureReason || check.skipReason) && (
              <div style={{
                marginTop: studioSpacing[4],
                fontSize: studioTypography.sm,
                color: check.status === "failed" ? studioColors.red : studioColors.textMuted,
              }}>
                {check.failureReason || check.skipReason}
              </div>
            )}
            {(check.stdoutRef || check.stderrRef) && (
              <div style={{ marginTop: studioSpacing[4] }}>
                <StudioDisclosure label="Details">
                  <pre style={{
                    fontSize: studioTypography.xs,
                    color: studioColors.textMuted,
                    fontFamily: studioTypography.mono,
                    whiteSpace: "pre-wrap",
                    margin: 0,
                  }}>
                    {check.stdoutRef && `stdout: ${check.stdoutRef}\n`}
                    {check.stderrRef && `stderr: ${check.stderrRef}`}
                  </pre>
                </StudioDisclosure>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
