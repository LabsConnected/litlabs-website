"use client";

import { type ReactNode } from "react";
import { studioColors, studioLayout, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";
import { StudioStatus, type StatusTone } from "../primitives/StudioStatus";

/* ─────────────────────────────────────────────────────────────────
 * StudioContextBar — Region 1: Top context/status bar.
 *
 * Always answers:
 * - Which project?
 * - Which branch and code state?
 * - Which runtime?
 * - Which model?
 * - Is the connection healthy?
 * - What is LiTT doing now?
 * - Does anything require attention?
 *
 * Order: Project / Branch / SHA → Runtime → Model → flexible space
 *        → Run state → Review status → overflow
 *
 * Phase 10.3 — Permanent shell
 * ───────────────────────────────────────────────────────────────── */

interface ContextBarItem {
  label: string;
  value: string;
  tone?: StatusTone;
  icon?: ReactNode;
}

interface StudioContextBarProps {
  /** Project name */
  project?: string;
  /** Branch name */
  branch?: string;
  /** HEAD SHA (short) */
  headSha?: string;
  /** Runtime status */
  runtimeStatus?: { label: string; tone: StatusTone };
  /** Model name */
  model?: string;
  /** Run state */
  runState?: { label: string; tone: StatusTone };
  /** Review status */
  reviewStatus?: { label: string; tone: StatusTone };
  /** Connection healthy */
  connectionHealthy?: boolean;
  /** Overflow menu items */
  overflow?: ContextBarItem[];
  /** Right-side actions */
  actions?: ReactNode;
}

export function StudioContextBar({
  project,
  branch,
  headSha,
  runtimeStatus,
  model,
  runState,
  reviewStatus,
  connectionHealthy,
  actions,
}: StudioContextBarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: studioSpacing[6],
        height: studioLayout.headerHeight,
        padding: `0 ${studioSpacing[8]}`,
        background: studioColors.shell,
        borderBottom: `1px solid ${studioColors.borderNeutral}`,
        flexShrink: 0,
        overflow: "hidden",
      }}
      data-testid="studio-context-bar"
      role="banner"
    >
      {/* Project / Branch / SHA */}
      <div style={{ display: "flex", alignItems: "center", gap: studioSpacing[4], flexShrink: 0 }}>
        {project && (
          <span
            style={{
              fontSize: studioTypography.md,
              fontWeight: 600,
              color: studioColors.textPrimary,
              whiteSpace: "nowrap",
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            data-testid="context-bar-project"
          >
            {project}
          </span>
        )}
        {branch && (
          <span
            style={{
              fontSize: studioTypography.sm,
              color: studioColors.textSecondary,
              fontFamily: studioTypography.mono,
              whiteSpace: "nowrap",
            }}
            data-testid="context-bar-branch"
          >
            {branch}
          </span>
        )}
        {headSha && (
          <span
            style={{
              fontSize: studioTypography.xs,
              color: studioColors.textMuted,
              fontFamily: studioTypography.mono,
              whiteSpace: "nowrap",
            }}
            data-testid="context-bar-sha"
          >
            {headSha}
          </span>
        )}
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 20, background: studioColors.borderNeutral, flexShrink: 0 }} />

      {/* Runtime */}
      {runtimeStatus && (
        <StudioStatus
          tone={runtimeStatus.tone}
          label={runtimeStatus.label}
          size="sm"
        />
      )}

      {/* Model */}
      {model && (
        <span
          style={{
            fontSize: studioTypography.sm,
            color: studioColors.textMuted,
            whiteSpace: "nowrap",
          }}
          data-testid="context-bar-model"
        >
          {model}
        </span>
      )}

      {/* Flexible space */}
      <div style={{ flex: 1 }} />

      {/* Connection health */}
      {connectionHealthy !== undefined && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: connectionHealthy ? studioColors.green : studioColors.red,
            flexShrink: 0,
          }}
          title={connectionHealthy ? "Connected" : "Disconnected"}
          data-testid="context-bar-connection"
        />
      )}

      {/* Run state */}
      {runState && (
        <StudioStatus
          tone={runState.tone}
          label={runState.label}
          size="sm"
        />
      )}

      {/* Review status */}
      {reviewStatus && (
        <StudioStatus
          tone={reviewStatus.tone}
          label={reviewStatus.label}
          size="sm"
        />
      )}

      {/* Actions */}
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: studioSpacing[2], flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </header>
  );
}
