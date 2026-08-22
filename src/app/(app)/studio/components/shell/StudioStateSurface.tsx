"use client";

import { type ReactNode } from "react";
import { studioColors, studioSpacing, studioTypography, studioMotion } from "@/lib/studio/design-tokens";
import { StudioButton } from "../primitives/StudioButton";
import { StudioSkeleton } from "../primitives/StudioSkeleton";

/* ─────────────────────────────────────────────────────────────────
 * StudioStateSurface — renders the correct workspace state.
 *
 * Handles all required operational states:
 * - no_project
 * - project_loading
 * - runtime_connecting
 * - runtime_unavailable
 * - empty_conversation
 * - plan_draft
 * - plan_approved
 * - act_running
 * - awaiting_approval
 * - check_running
 * - check_failing
 * - check_passing
 * - evidence_stale
 * - acceptance_incomplete
 * - acceptance_complete
 * - ready_for_review
 * - changes_requested
 * - approved
 * - preview_unavailable
 * - general_error
 *
 * Phase 10.6 — State completeness
 * ───────────────────────────────────────────────────────────────── */

export type StudioState =
  | "no_project"
  | "project_loading"
  | "runtime_connecting"
  | "runtime_unavailable"
  | "empty_conversation"
  | "plan_draft"
  | "plan_approved"
  | "act_running"
  | "awaiting_approval"
  | "check_running"
  | "check_failing"
  | "check_passing"
  | "evidence_stale"
  | "acceptance_incomplete"
  | "acceptance_complete"
  | "ready_for_review"
  | "changes_requested"
  | "approved"
  | "preview_unavailable"
  | "general_error";

interface StudioStateSurfaceProps {
  state: StudioState;
  /** Custom message override */
  message?: string;
  /** Recovery action */
  onAction?: () => void;
  actionLabel?: string;
  /** Children to render when state is normal (empty_conversation or running states) */
  children?: ReactNode;
}

interface StateConfig {
  title: string;
  description: string;
  icon: string;
  tone: "idle" | "info" | "success" | "warning" | "error" | "violet";
  showSkeleton?: boolean;
  showChildren?: boolean;
}

function stateConfig(state: StudioState): StateConfig {
  switch (state) {
    case "no_project":
      return {
        title: "No project selected",
        description: "Select a project from the rail to start working.",
        icon: "📁", tone: "idle",
      };
    case "project_loading":
      return {
        title: "Loading project…",
        description: "Resolving project, workspace, and runtime.",
        icon: "⏳", tone: "info", showSkeleton: true,
      };
    case "runtime_connecting":
      return {
        title: "Connecting to runtime…",
        description: "Establishing terminal, file system, and git access.",
        icon: "🔌", tone: "info", showSkeleton: true,
      };
    case "runtime_unavailable":
      return {
        title: "Runtime unavailable",
        description: "The workspace runtime could not be reached. Check your connection and try again.",
        icon: "⚠", tone: "error",
      };
    case "empty_conversation":
      return {
        title: "Start a conversation",
        description: "Ask LiTT to plan, build, or fix something.",
        icon: "💬", tone: "idle", showChildren: true,
      };
    case "plan_draft":
      return {
        title: "Planning in progress",
        description: "LiTT is drafting a plan. Review it when ready.",
        icon: "📋", tone: "violet", showChildren: true,
      };
    case "plan_approved":
      return {
        title: "Plan approved",
        description: "LiTT can now start acting on the approved plan.",
        icon: "✓", tone: "success", showChildren: true,
      };
    case "act_running":
      return {
        title: "LiTT is working",
        description: "Editing files, running commands, and capturing evidence.",
        icon: "⚡", tone: "violet", showChildren: true,
      };
    case "awaiting_approval":
      return {
        title: "Approval required",
        description: "LiTT needs approval to proceed with a high-impact action.",
        icon: "⏸", tone: "warning", showChildren: true,
      };
    case "check_running":
      return {
        title: "Running checks",
        description: "Typecheck, tests, build, and browser validation in progress.",
        icon: "🔍", tone: "info", showChildren: true,
      };
    case "check_failing":
      return {
        title: "Checks failed",
        description: "One or more required checks failed. Review the output and fix issues.",
        icon: "✗", tone: "error", showChildren: true,
      };
    case "check_passing":
      return {
        title: "Checks passed",
        description: "All required checks are passing.",
        icon: "✓", tone: "success", showChildren: true,
      };
    case "evidence_stale":
      return {
        title: "Evidence is stale",
        description: "Code changed after evidence was captured. Re-run checks to update.",
        icon: "⚠", tone: "warning", showChildren: true,
      };
    case "acceptance_incomplete":
      return {
        title: "Acceptance incomplete",
        description: "Not all acceptance criteria have been verified yet.",
        icon: "○", tone: "warning", showChildren: true,
      };
    case "acceptance_complete":
      return {
        title: "Acceptance verified",
        description: "All acceptance criteria have been verified with concrete evidence.",
        icon: "✓", tone: "success", showChildren: true,
      };
    case "ready_for_review":
      return {
        title: "Ready for review",
        description: "All checks pass, acceptance is verified, and a checkpoint is ready to capture.",
        icon: "✓", tone: "violet", showChildren: true,
      };
    case "changes_requested":
      return {
        title: "Changes requested",
        description: "Review feedback has been recorded. LiTT should address the requested changes.",
        icon: "↻", tone: "warning", showChildren: true,
      };
    case "approved":
      return {
        title: "Approved",
        description: "The review checkpoint has been approved for this code state.",
        icon: "✓", tone: "success", showChildren: true,
      };
    case "preview_unavailable":
      return {
        title: "Preview unavailable",
        description: "The project preview could not be loaded. Check if the dev server is running.",
        icon: "⚠", tone: "warning",
      };
    case "general_error":
      return {
        title: "Something went wrong",
        description: "An unexpected error occurred. Try again or check the console for details.",
        icon: "✗", tone: "error",
      };
  }
}

function toneColor(tone: StateConfig["tone"]): string {
  switch (tone) {
    case "success": return studioColors.green;
    case "warning": return studioColors.amber;
    case "error": return studioColors.red;
    case "info": return studioColors.blue;
    case "violet": return studioColors.violet;
    case "idle":
    default: return studioColors.gray;
  }
}

export function StudioStateSurface({ state, message, onAction, actionLabel, children }: StudioStateSurfaceProps) {
  const config = stateConfig(state);
  const color = toneColor(config.tone);

  // For states that show children, render children with a compact status header
  if (config.showChildren && children) {
    return (
      <div data-testid={`state-surface-${state}`} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: studioSpacing[4],
          padding: `${studioSpacing[4]} ${studioSpacing[8]}`,
          borderBottom: `1px solid ${studioColors.borderNeutral}`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: studioTypography.lg }}>{config.icon}</span>
          <div>
            <div style={{
              fontSize: studioTypography.md,
              fontWeight: 600,
              color,
            }}>
              {config.title}
            </div>
            <div style={{
              fontSize: studioTypography.sm,
              color: studioColors.textMuted,
            }}>
              {message ?? config.description}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {children}
        </div>
      </div>
    );
  }

  // Full-screen state
  return (
    <div
      data-testid={`state-surface-${state}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: studioSpacing[20],
        textAlign: "center",
      }}
    >
      <div style={{
        fontSize: 48,
        marginBottom: studioSpacing[8],
        opacity: 0.8,
        animation: state === "project_loading" || state === "runtime_connecting"
          ? `studio-spin ${studioMotion.slow} linear infinite`
          : "none",
      }}>
        {config.icon}
      </div>
      <div style={{
        fontSize: studioTypography.xl,
        fontWeight: 600,
        color,
        marginBottom: studioSpacing[4],
      }}>
        {config.title}
      </div>
      <div style={{
        fontSize: studioTypography.md,
        color: studioColors.textMuted,
        maxWidth: 400,
        lineHeight: 1.6,
        marginBottom: studioSpacing[12],
      }}>
        {message ?? config.description}
      </div>

      {config.showSkeleton && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: studioSpacing[4],
          width: "100%",
          maxWidth: 320,
          marginBottom: studioSpacing[12],
        }}>
          <StudioSkeleton height={16} />
          <StudioSkeleton height={16} width="80%" />
          <StudioSkeleton height={16} width="60%" />
        </div>
      )}

      {onAction && actionLabel && (
        <StudioButton
          variant="primary"
          size="md"
          onClick={onAction}
          data-testid="state-action-btn"
        >
          {actionLabel}
        </StudioButton>
      )}
    </div>
  );
}
