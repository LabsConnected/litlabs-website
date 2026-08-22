"use client";

import { type ReactNode } from "react";
import { studioColors, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";
import { StudioPanel } from "../primitives/StudioPanel";
import { StudioEmptyState } from "../primitives/StudioEmptyState";

/* ─────────────────────────────────────────────────────────────────
 * PlanPanel — Inspector tab: Plan.
 *
 * Explains intended work. Shows the plan, acceptance criteria,
 * and PLAN/ACT mode.
 *
 * Phase 10.4 — Inspector consolidation
 * ───────────────────────────────────────────────────────────────── */

interface PlanPanelProps {
  plan: string | null;
  acceptanceCriteria: string[];
  mode: "PLAN" | "ACT";
  planApproved: boolean;
  loading?: boolean;
}

export function PlanPanel({ plan, acceptanceCriteria, mode, planApproved, loading }: PlanPanelProps) {
  if (loading) {
    return <div style={{ padding: studioSpacing[8] }} data-testid="plan-panel-loading">Loading plan…</div>;
  }

  if (!plan) {
    return (
      <StudioEmptyState
        title="No plan yet"
        description="Ask LiTT to plan the work. The plan will appear here with acceptance criteria."
        testId="plan-panel-empty"
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[6] }} data-testid="plan-panel">
      <StudioPanel title="Mode" testId="plan-mode-panel">
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: studioSpacing[4],
          fontSize: studioTypography.md,
        }}>
          <span style={{
            padding: `${studioSpacing[1]} ${studioSpacing[4]}`,
            borderRadius: "4px",
            background: mode === "PLAN" ? studioColors.violetSoft : studioColors.graySoft,
            color: mode === "PLAN" ? studioColors.violet : studioColors.gray,
            fontWeight: 600,
            fontSize: studioTypography.sm,
          }}>
            {mode}
          </span>
          {planApproved && (
            <span style={{ color: studioColors.green, fontSize: studioTypography.sm }}>
              ✓ Approved
            </span>
          )}
        </div>
      </StudioPanel>

      <StudioPanel title="Plan" testId="plan-content-panel">
        <div
          style={{
            fontSize: studioTypography.md,
            lineHeight: 1.6,
            color: studioColors.textSecondary,
            whiteSpace: "pre-wrap",
          }}
        >
          {plan}
        </div>
      </StudioPanel>

      {acceptanceCriteria.length > 0 && (
        <StudioPanel title={`Acceptance Criteria (${acceptanceCriteria.length})`} testId="plan-criteria-panel">
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {acceptanceCriteria.map((criterion, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: studioSpacing[4],
                  padding: `${studioSpacing[2]} 0`,
                  fontSize: studioTypography.md,
                  color: studioColors.textSecondary,
                  borderBottom: i < acceptanceCriteria.length - 1 ? `1px solid ${studioColors.borderNeutral}` : "none",
                }}
              >
                <span style={{ color: studioColors.violet, flexShrink: 0 }}>○</span>
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </StudioPanel>
      )}
    </div>
  );
}
