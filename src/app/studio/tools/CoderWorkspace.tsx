"use client";

/**
 * CoderWorkspace — canonical coder UI shell (Phase 1).
 *
 * This is the replacement for CanvasTool as the default `tool=code` surface.
 * Phase 1 is a SHELL ONLY: it reads from existing Project, files, preview,
 * Canvas, checkpoint, and conversation APIs and displays truthful state.
 * It does NOT call /api/litt/run, does NOT execute AI, and does NOT mutate
 * files. The composer is visible but non-functional — it shows a truthful
 * "not wired yet" state until Phase 2 connects it to the canonical run API.
 *
 * Layout (per Handbook Section 11 + rebuild directive Section 2):
 *   Desktop (≥1024px):
 *     - Top bar: Project | Branch | Run status | Model | Credits
 *     - Left rail: LiTT conversation + Plan/timeline tabs
 *     - Right pane: Files | Code | Preview | Review tabs
 *     - Bottom drawer: Canvas | Terminal (collapsible)
 *     - Persistent composer at bottom of left rail
 *   Mobile/tablet (<1024px):
 *     - Top bar: Project | Run status | Menu
 *     - Main: Conversation OR work view (toggle)
 *     - Persistent composer
 *     - Bottom sheet: Files | Code | Preview | Canvas | Terminal
 *
 * @see docs/litt/phase-1-2-plan.md
 *
 * NOTE: This file is a thin orchestrator. Responsibilities are decomposed into
 * focused modules under ./coder-workspace/:
 *   - hooks.ts        — existing-API data loaders (useProjectData, useFilesData, …)
 *   - types.ts        — local API response shapes
 *   - StateViews.tsx  — EmptyState, LoadingState, ErrorState
 *   - ProjectBar.tsx  — top project selector + workspace status
 *   - LeftRail.tsx    — LiTT conversation + Plan/timeline tabs
 *   - RightPane.tsx   — Files | Code | Preview | Review tabs
 *   - BottomDrawer.tsx— Canvas | Terminal drawer (desktop)
 *   - MobileSheet.tsx — bottom sheet (mobile/tablet)
 *   - Composer.tsx    — persistent message input (non-functional in Phase 1)
 */

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProjectData } from "./coder-workspace/hooks";
import { BottomDrawer } from "./coder-workspace/BottomDrawer";
import { Composer } from "./coder-workspace/Composer";
import { LeftRail } from "./coder-workspace/LeftRail";
import { MobileSheet } from "./coder-workspace/MobileSheet";
import { ProjectBar } from "./coder-workspace/ProjectBar";
import { RightPane } from "./coder-workspace/RightPane";

export default function CoderWorkspace() {
  const { resolvedColors: T } = useTheme();
  const { projects, status: projectsStatus, error: projectsError, refresh } =
    useProjectData();
  const [projectId, setProjectId] = useState("");

  // Auto-select the first project once the list loads.
  useEffect(() => {
    setProjectId((current) => current || projects[0]?.id || "");
  }, [projects]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Top bar: Project | Run status | Model | Credits */}
      <ProjectBar
        projects={projects}
        projectId={projectId}
        onSelect={setProjectId}
        onRefresh={refresh}
        loading={projectsStatus === "loading"}
        T={T}
      />
      {projectsError && (
        <div
          className="shrink-0 border-b px-3 py-1 text-[10px] text-red-300"
          style={{ borderColor: `${T.borderColor}30` }}
        >
          {projectsError}
        </div>
      )}

      {/* Desktop layout: 2-col grid (left rail | right pane) — ≥1024px */}
      <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        {/* Left rail: conversation + plan/timeline + composer */}
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <LeftRail projectId={projectId} T={T} />
          <Composer T={T} />
        </div>

        {/* Right pane: Files | Code | Preview | Review — desktop only */}
        <div
          className="hidden min-h-0 min-w-0 flex-col border-l lg:flex"
          style={{ borderColor: `${T.borderColor}30` }}
        >
          <RightPane projectId={projectId} project={selectedProject} T={T} />
        </div>
      </div>

      {/* Bottom drawer: Canvas | Terminal — desktop only (≥1024px) */}
      <div className="hidden lg:block">
        <BottomDrawer projectId={projectId} T={T} />
      </div>

      {/* Mobile/tablet work sheet (<1024px) */}
      <MobileSheet projectId={projectId} T={T} />
    </div>
  );
}
