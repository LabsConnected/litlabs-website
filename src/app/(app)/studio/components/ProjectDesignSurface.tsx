"use client";

import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import StudioPreviewPanel, { type PreviewSelection } from "./StudioPreviewPanel";
import { useStudioContext } from "../context/StudioContext";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useProjectRuntime } from "../hooks/useProjectRuntime";

/**
 * ProjectDesignSurface is deliberately project-first. It renders the active
 * project's real preview inside Design while the source-backed visual editor
 * attaches. It never falls back to the new-project greeter for an existing
 * project.
 */
export function ProjectDesignSurface() {
  const { projectId, selection, setSelection } = useStudioContext();
  const { capabilities } = useConnectionSummary();
  const runtime = useProjectRuntime();

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-white/50">
        <p>Design has no active project. Select a project before editing.</p>
      </div>
    );
  }

  if (runtime.loading && !runtime.state.projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
        <Loader2 size={22} className="animate-spin" aria-hidden="true" />
        <p className="text-sm">Loading {capabilities.projectName ?? "project"} design…</p>
      </div>
    );
  }

  if (runtime.error || runtime.state.phase === "error" || runtime.state.phase === "workspace_not_provisioned" || runtime.state.phase === "workspace_not_ready") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-red-400/20 bg-red-500/5 p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 text-red-300" size={24} aria-hidden="true" />
          <h2 className="text-base font-bold text-white">Design view couldn&apos;t load this project.</h2>
          <p className="mt-2 text-sm text-white/60">{runtime.error ?? "The project workspace is unavailable."}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={() => void runtime.refresh()} className="flex min-h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm font-semibold text-white">
              <RotateCw size={14} aria-hidden="true" /> Retry
            </button>
            <a href={`/studio?tool=preview&project=${encodeURIComponent(projectId)}`} className="flex min-h-10 items-center rounded-lg border border-white/10 px-4 text-sm font-semibold text-white/80">Open Preview</a>
            <a href={`/studio?tool=code&project=${encodeURIComponent(projectId)}`} className="flex min-h-10 items-center rounded-lg border border-white/10 px-4 text-sm font-semibold text-white/80">Open Code</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="project-design-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-300">Design</p>
          <h2 className="text-sm font-semibold text-white">{capabilities.projectName ?? "Active project"}</h2>
        </div>
        {selection && <span className="text-xs text-white/50">Selected: {selection.content ?? selection.componentName ?? selection.elementId}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <StudioPreviewPanel
          projectId={projectId}
          projectName={capabilities.projectName}
          repositoryName={capabilities.repositoryName}
          branch={capabilities.activeBranch}
          workspaceStatus={runtime.state.workspaceStatus}
          sourceKind={capabilities.sourceKind}
          sourceStatus={capabilities.sourceStatus}
          versionControl={capabilities.versionControl}
          onSelectionChange={(next: PreviewSelection | null) => {
            setSelection(next ? { elementId: next.selector, componentName: next.tagName, content: next.label } : null);
          }}
        />
      </div>
    </div>
  );
}
