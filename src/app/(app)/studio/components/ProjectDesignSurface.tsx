"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Hand, Loader2, Magnet, MousePointer2, Move, Redo2, RotateCw, Undo2 } from "lucide-react";
import StudioPreviewPanel, { type PreviewSelection } from "./StudioPreviewPanel";
import { useStudioContext } from "../context/StudioContext";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useProjectRuntime } from "../hooks/useProjectRuntime";
import { useSharedElementEdits } from "../context/ElementEditsContext";
import type { ElementPatch } from "../lib/element-edits";

type CanvasTool = "select" | "pan" | "edit";

/** Change payload the injected inspector bridge posts on gesture commit. */
interface GeometryChange {
  kind: "reorder" | "offset" | "resize" | "align";
  position?: "before" | "after" | "into";
  ref?: { selector: string; tagName: string; attrs?: Record<string, string>; path?: string };
  styles?: Record<string, string | null>;
}

/**
 * ProjectDesignSurface is the Design tab's project-backed visual editor.
 * It embeds the live preview (StudioPreviewPanel + inspector bridge) and
 * turns pointer gestures into real workspace-file patches through the
 * shared useElementEdits write path — project files stay the only
 * document model; nothing is mirrored into a second canvas tree.
 */
export function ProjectDesignSurface({
  onPreviewSelectionChange,
}: {
  onPreviewSelectionChange?: (selection: PreviewSelection | null) => void;
}) {
  const { projectId, selection } = useStudioContext();
  const { capabilities } = useConnectionSummary();
  const runtime = useProjectRuntime();
  const edits = useSharedElementEdits(projectId);
  const [tool, setTool] = useState<CanvasTool>("edit");
  const [snap, setSnap] = useState(true);

  /**
   * Geometry commits arrive from the in-frame inspector with the full
   * element identity + a semantic change description. We re-resolve the
   * element against the CURRENT file bytes (picks up any agent edits since
   * selection) and apply the patch through the CAS-pinned write path.
   */
  const handleBridgeMessage = useCallback((type: string, payload: unknown) => {
    if (type !== "geometry-commit") return;
    const p = payload as (PreviewSelection & { change?: GeometryChange }) | null;
    const change = p?.change;
    if (!p || !change) return;

    const identity = {
      selector: p.selector,
      tagName: p.tagName,
      label: p.label,
      attrs: p.attrs,
      text: p.text,
      path: p.path,
    };
    let patch: ElementPatch | null = null;
    if (change.kind === "reorder" && change.ref && change.position) {
      patch = {
        move: {
          ref: {
            selector: change.ref.selector,
            tagName: change.ref.tagName,
            attrs: change.ref.attrs,
            path: change.ref.path,
          },
          position: change.position,
        },
      };
    } else if (change.styles && Object.keys(change.styles).length > 0) {
      patch = { styles: change.styles };
    }
    if (!patch) return;
    void (async () => {
      await edits.resolve(identity, null);
      await edits.applyPatch(patch);
    })();
  }, [edits]);

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

  const toolButtons: { id: CanvasTool; label: string; icon: typeof MousePointer2; hint: string }[] = [
    { id: "select", label: "Select", icon: MousePointer2, hint: "Click elements to inspect" },
    { id: "pan", label: "Pan", icon: Hand, hint: "Drag to scroll the page" },
    { id: "edit", label: "Edit", icon: Move, hint: "Drag to reorder, corner handles to resize" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="project-design-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-300">Design</p>
          <h2 className="truncate text-sm font-semibold text-white">{capabilities.projectName ?? "Active project"}</h2>
        </div>
        {selection && (
          <span className="hidden max-w-[40%] truncate text-xs text-white/50 md:inline" title={selection.selector}>
            Selected: {selection.content ?? selection.componentName ?? selection.elementId}
          </span>
        )}
      </div>

      {/* Canvas toolbar — tools, snapping, undo/redo over the shared
          element-edit write path. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3 py-1.5" role="toolbar" aria-label="Design canvas tools">
        <div className="flex items-center gap-0.5 rounded-lg border border-white/10 p-0.5" role="group" aria-label="Tool">
          {toolButtons.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              title={hint}
              aria-pressed={tool === id}
              data-testid={`design-tool-${id}`}
              className="flex min-h-7 items-center gap-1 rounded-md px-2 text-[10px] font-bold transition-colors"
              style={{
                background: tool === id ? "rgba(155,77,255,0.22)" : "transparent",
                color: tool === id ? "#c4b5fd" : "rgba(255,255,255,0.55)",
              }}
            >
              <Icon size={11} className="pointer-events-none" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSnap((v) => !v)}
          aria-pressed={snap}
          title="Snap to sibling/parent/viewport edges while dragging"
          data-testid="design-snap-toggle"
          className="flex min-h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-bold"
          style={{
            borderColor: snap ? "rgba(155,77,255,0.4)" : "rgba(255,255,255,0.12)",
            color: snap ? "#c4b5fd" : "rgba(255,255,255,0.55)",
          }}
        >
          <Magnet size={11} className="pointer-events-none" aria-hidden="true" />
          Snap
        </button>
        <div className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
        <button
          type="button"
          onClick={() => void edits.undo()}
          disabled={!edits.canUndo}
          title="Undo last element edit"
          aria-label="Undo"
          data-testid="design-undo"
          className="grid h-7 w-7 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 disabled:opacity-30"
        >
          <Undo2 size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void edits.redo()}
          disabled={!edits.canRedo}
          title="Redo element edit"
          aria-label="Redo"
          data-testid="design-redo"
          className="grid h-7 w-7 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 disabled:opacity-30"
        >
          <Redo2 size={12} aria-hidden="true" />
        </button>
        {edits.status === "conflict" && (
          <span className="ml-auto truncate rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-200" data-testid="design-conflict-badge" title={edits.statusReason ?? undefined}>
            File changed on disk — re-select to reload
          </span>
        )}
        {edits.status === "applying" && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-white/50">
            <Loader2 size={10} className="animate-spin" aria-hidden="true" /> Saving…
          </span>
        )}
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
          lockSelection
          inspectorTool={tool}
          snapEnabled={snap}
          onBridgeMessage={handleBridgeMessage}
          onSelectionChange={(next: PreviewSelection | null) => {
            // Full-fidelity sink → CommandStudio previewSelection →
            // ElementInspectorPanel + composer chips. The legacy context
            // selection derives from previewSelection automatically, so
            // routing through setSelection here would only degrade it.
            onPreviewSelectionChange?.(next);
          }}
        />
      </div>
    </div>
  );
}
