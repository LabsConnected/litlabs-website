"use client";

import { type ReactNode } from "react";
import { studioColors, studioSpacing, studioTypography, studioMotion, type StatusTone } from "@/lib/studio/design-tokens";
import { StudioEmptyState } from "../primitives/StudioEmptyState";
import { StudioStatus } from "../primitives/StudioStatus";

/* ─────────────────────────────────────────────────────────────────
 * ActivityPanel — Inspector tab: Activity.
 *
 * Explains what is happening now. Streams tool calls, phase changes,
 * approvals, and events. NOT chain-of-thought — actionable summaries.
 *
 * Phase 10.4 — Inspector consolidation
 * ───────────────────────────────────────────────────────────────── */

interface ActivityItem {
  id: string;
  type: "phase" | "tool_start" | "tool_result" | "tool_error" | "checkpoint" | "approval" | "finished";
  summary: string;
  timestamp: number;
  success?: boolean;
  durationMs?: number;
}

interface ActivityPanelProps {
  items: ActivityItem[];
  isRunning: boolean;
  pendingApproval?: { toolId: string; reason: string } | null;
  loading?: boolean;
}

function itemTone(item: ActivityItem): StatusTone {
  if (item.type === "tool_error") return "error";
  if (item.type === "approval") return "warning";
  if (item.type === "finished" && item.success === false) return "error";
  if (item.type === "tool_result" && item.success === false) return "error";
  if (item.type === "finished" && item.success === true) return "success";
  if (item.type === "tool_result" && item.success === true) return "success";
  if (item.type === "checkpoint") return "violet";
  if (item.type === "phase") return "info";
  return "idle";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ActivityPanel({ items, isRunning, pendingApproval, loading }: ActivityPanelProps) {
  if (loading) {
    return <div style={{ padding: studioSpacing[8] }} data-testid="activity-panel-loading">Loading activity…</div>;
  }

  if (items.length === 0 && !isRunning) {
    return (
      <StudioEmptyState
        title="No activity yet"
        description="When LiTT starts working, tool calls, phase changes, and events will stream here."
        testId="activity-panel-empty"
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[2] }} data-testid="activity-panel">
      {pendingApproval && (
        <div
          style={{
            padding: studioSpacing[6],
            borderRadius: "8px",
            background: studioColors.amberSoft,
            border: "1px solid rgba(251, 178, 68, 0.25)",
            fontSize: studioTypography.md,
            color: studioColors.amber,
          }}
          data-testid="activity-pending-approval"
        >
          ⏸ Approval required: {pendingApproval.reason}
        </div>
      )}

      {items.map((item) => {
        const tone = itemTone(item);
        return (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: studioSpacing[4],
              padding: `${studioSpacing[4]} ${studioSpacing[6]}`,
              borderRadius: "6px",
              background: studioColors.card,
              border: `1px solid ${studioColors.borderNeutral}`,
            }}
            data-testid={`activity-item-${item.id}`}
          >
            <StudioStatus tone={tone} label="" dot={true} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: studioTypography.md,
                color: studioColors.textPrimary,
                lineHeight: 1.4,
              }}>
                {item.summary}
              </div>
              <div style={{
                display: "flex",
                gap: studioSpacing[4],
                marginTop: studioSpacing[2],
                fontSize: studioTypography.xs,
                color: studioColors.textMuted,
              }}>
                <span>{formatTime(item.timestamp)}</span>
                {item.durationMs !== undefined && (
                  <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {isRunning && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: studioSpacing[4],
            padding: studioSpacing[6],
            color: studioColors.violet,
            fontSize: studioTypography.md,
          }}
          data-testid="activity-running-indicator"
        >
          <span style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: studioColors.violet,
            animation: `studio-spin ${studioMotion.normal} linear infinite`,
          }} />
          LiTT is working…
        </div>
      )}
    </div>
  );
}
