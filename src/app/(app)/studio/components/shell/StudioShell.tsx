"use client";

import { type ReactNode } from "react";
import { studioColors, studioLayout } from "@/lib/studio/design-tokens";
import { StudioContextBar } from "./StudioContextBar";
import { StudioProductRail, type RailDestination } from "./StudioProductRail";
import { StudioWorkspace } from "./StudioWorkspace";
import { StudioInspector, type InspectorTabId } from "./StudioInspector";
import { StudioComposer } from "./StudioComposer";

/* ─────────────────────────────────────────────────────────────────
 * StudioShell — the permanent 5-region Studio layout.
 *
 * Region 1: Top context bar (always answers: what project, what
 *           branch, what runtime, what model, what LiTT is doing)
 * Region 2: Left product rail (primary destinations)
 * Region 3: Primary workspace (conversation, code, preview, diff)
 * Region 4: Right intelligence inspector (Plan/Activity/Changes/
 *           Checks/Acceptance/Review)
 * Region 5: Bottom composer (prompt input, mode controls, actions)
 *
 * This shell is designed to wrap existing content during migration.
 * CommandStudio.tsx will gradually delegate to this shell rather
 * than implementing its own layout.
 *
 * Phase 10.3 — Permanent shell
 * ───────────────────────────────────────────────────────────────── */

interface StudioShellProps {
  // ── Region 1: Context bar ──
  project?: string;
  branch?: string;
  headSha?: string;
  runtimeStatus?: { label: string; tone: "idle" | "info" | "success" | "warning" | "error" | "violet" };
  model?: string;
  runState?: { label: string; tone: "idle" | "info" | "success" | "warning" | "error" | "violet" };
  reviewStatus?: { label: string; tone: "idle" | "info" | "success" | "warning" | "error" | "violet" };
  connectionHealthy?: boolean;
  contextActions?: ReactNode;

  // ── Region 2: Product rail ──
  railDestinations: RailDestination[];
  activeDestination: string;
  onDestinationChange: (id: string) => void;
  railSecondaryDestinations?: RailDestination[];
  railCompact?: boolean;

  // ── Region 3: Workspace ──
  workspaceContent: ReactNode;
  workspaceSplit?: ReactNode;
  split?: boolean;

  // ── Region 4: Inspector ──
  inspectorActiveTab: InspectorTabId;
  onInspectorTabChange: (tab: InspectorTabId) => void;
  inspectorBadges?: Partial<Record<InspectorTabId, number>>;
  renderInspectorTab: (tab: InspectorTabId) => ReactNode;
  inspectorOpen?: boolean;
  onInspectorClose?: () => void;
  inspectorWidth?: string;

  // ── Region 5: Composer ──
  composerContent: ReactNode;
  composerRunProgress?: ReactNode;
  composerDisabled?: boolean;
}

export function StudioShell({
  // Region 1
  project,
  branch,
  headSha,
  runtimeStatus,
  model,
  runState,
  reviewStatus,
  connectionHealthy,
  contextActions,
  // Region 2
  railDestinations,
  activeDestination,
  onDestinationChange,
  railSecondaryDestinations,
  railCompact,
  // Region 3
  workspaceContent,
  workspaceSplit,
  split,
  // Region 4
  inspectorActiveTab,
  onInspectorTabChange,
  inspectorBadges,
  renderInspectorTab,
  inspectorOpen = true,
  onInspectorClose,
  inspectorWidth,
  // Region 5
  composerContent,
  composerRunProgress,
  composerDisabled,
}: StudioShellProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: studioColors.canvas,
        color: studioColors.textPrimary,
        overflow: "hidden",
      }}
      data-testid="studio-shell"
    >
      {/* Region 1: Top context bar */}
      <StudioContextBar
        project={project}
        branch={branch}
        headSha={headSha}
        runtimeStatus={runtimeStatus}
        model={model}
        runState={runState}
        reviewStatus={reviewStatus}
        connectionHealthy={connectionHealthy}
        actions={contextActions}
      />

      {/* Main content area: rail + workspace + inspector */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Region 2: Left product rail */}
        <StudioProductRail
          destinations={railDestinations}
          activeDestination={activeDestination}
          onDestinationChange={onDestinationChange}
          secondaryDestinations={railSecondaryDestinations}
          compact={railCompact}
        />

        {/* Region 3: Primary workspace */}
        <StudioWorkspace split={split} splitView={workspaceSplit}>
          {workspaceContent}
        </StudioWorkspace>

        {/* Region 4: Right intelligence inspector */}
        <StudioInspector
          activeTab={inspectorActiveTab}
          onTabChange={onInspectorTabChange}
          badges={inspectorBadges}
          renderTab={renderInspectorTab}
          open={inspectorOpen}
          onClose={onInspectorClose}
          width={inspectorWidth}
        />
      </div>

      {/* Region 5: Bottom composer */}
      <StudioComposer
        runProgress={composerRunProgress}
        disabled={composerDisabled}
      >
        {composerContent}
      </StudioComposer>
    </div>
  );
}
