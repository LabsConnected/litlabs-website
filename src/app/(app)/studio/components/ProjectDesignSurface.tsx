"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import StudioPreviewPanel, { type PreviewSelection } from "./StudioPreviewPanel";
import { DirectManipulationCanvas, type DirectCommit } from "./canvas/DirectManipulationCanvas";
import { useStudioContext } from "../context/StudioContext";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useProjectRuntime } from "../hooks/useProjectRuntime";
import { useElementEditSessionOptional } from "../hooks/element-edit-session";

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
  const edits = useElementEditSessionOptional();
  // The live preview stays one click away. The canvas is the default on
  // Design because that rail is the editable surface; Preview is its own rail.
  const [view, setView] = useState<"canvas" | "preview">("canvas");

  const publishSelection = (next: PreviewSelection | null) => {
    setSelection(next ? {
      elementId: next.selector,
      label: next.label,
      selector: next.selector,
      tagName: next.tagName,
      componentName: next.tagName,
      content: next.label,
      attrs: next.attrs,
      styles: next.styles,
      text: next.text,
      path: next.path,
      rect: next.rect,
    } : null);
  };

  const commitCanvas = async (commit: DirectCommit) => {
    const next: PreviewSelection = {
      label: commit.element.label,
      selector: commit.element.selector,
      tagName: commit.element.tagName,
      text: commit.element.text,
      styles: { ...commit.patch.styles },
      rect: {
        x: Math.round(commit.element.x),
        y: Math.round(commit.element.y),
        width: Math.round(commit.element.width),
        height: Math.round(commit.element.height),
      },
    };
    publishSelection(next);
    if (!edits) return;
    const identity = {
      selector: next.selector,
      tagName: next.tagName,
      label: next.label,
      text: next.text,
    };
    let ok = await edits.applyPatch(commit.patch);
    if (!ok) {
      await edits.resolve(identity, null);
      ok = await edits.applyPatch(commit.patch);
    }
  };

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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-300">Design</p>
          <h2 className="truncate text-sm font-semibold text-white">{capabilities.projectName ?? "Active project"}</h2>
        </div>
        <div className="flex items-center gap-2">
          {selection && <span className="hidden text-xs text-white/50 sm:inline">Selected: {selection.content ?? selection.componentName ?? selection.elementId}</span>}
          <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Design surface">
            <button
              type="button"
              data-testid="design-view-canvas"
              aria-pressed={view === "canvas"}
              className="rounded-md px-2.5 py-1 text-[10px] font-bold"
              style={{ background: view === "canvas" ? "rgba(155,77,255,0.2)" : "transparent", color: view === "canvas" ? "#e9d5ff" : "rgba(255,255,255,0.55)" }}
              onClick={() => setView("canvas")}
            >
              Canvas
            </button>
            <button
              type="button"
              data-testid="design-view-preview"
              aria-pressed={view === "preview"}
              className="rounded-md px-2.5 py-1 text-[10px] font-bold"
              style={{ background: view === "preview" ? "rgba(155,77,255,0.2)" : "transparent", color: view === "preview" ? "#e9d5ff" : "rgba(255,255,255,0.55)" }}
              onClick={() => setView("preview")}
            >
              Preview
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {view === "canvas" ? (
          <DirectManipulationCanvas
            onSelect={(element) => {
              if (!element) {
                publishSelection(null);
                return;
              }
              publishSelection({
                label: element.label,
                selector: element.selector,
                tagName: element.tagName,
                text: element.text,
                styles: {
                  position: "absolute",
                  left: `${Math.round(element.x)}px`,
                  top: `${Math.round(element.y)}px`,
                  width: `${Math.round(element.width)}px`,
                  height: `${Math.round(element.height)}px`,
                },
                rect: {
                  x: Math.round(element.x),
                  y: Math.round(element.y),
                  width: Math.round(element.width),
                  height: Math.round(element.height),
                },
              });
            }}
            onCommit={(commit) => { void commitCanvas(commit); }}
          />
        ) : (
          <StudioPreviewPanel
            projectId={projectId}
            projectName={capabilities.projectName}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch}
            workspaceStatus={runtime.state.workspaceStatus}
            sourceKind={capabilities.sourceKind}
            sourceStatus={capabilities.sourceStatus}
            versionControl={capabilities.versionControl}
            onSelectionChange={publishSelection}
          />
        )}
      </div>
    </div>
  );
}
