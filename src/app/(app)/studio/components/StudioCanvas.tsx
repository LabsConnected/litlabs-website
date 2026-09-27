"use client";

/**
 * StudioCanvas — the Studio route's freeform workspace compositor.
 *
 * Layout:
 *   .studio-canvas-root            fixed-size container (owns chrome)
 *   ├─ StudioCanvasViewport        pan/zoom surface (transform)
 *   │   └─ .studio-canvas          dot-grid world + StudioWindowFrames
 *   ├─ launcher (+ New Window)     chrome — never pans/zooms
 *   ├─ empty state                 chrome
 *   └─ .studio-taskbar             minimized windows + reset — chrome
 *
 * All window behavior lives in useStudioWindowStore — this file contains
 * no drag/resize/z-index logic of its own. Tool content is supplied by
 * the caller via `renderWindowContent`, so the canvas stays decoupled
 * from tool internals.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, RotateCcw } from "lucide-react";
import {
  STUDIO_WINDOW_TITLES,
  useProjectWindows,
  useStudioWindowStore,
} from "../stores/useStudioWindowStore";
import type { StudioWindow, StudioWindowType } from "../types/studio-windows";
import StudioWindowFrame from "./StudioWindowFrame";
import StudioCanvasViewport from "./StudioCanvasViewport";

export const STUDIO_WINDOW_MENU: { type: StudioWindowType; label: string; hint: string }[] = [
  { type: "chat", label: "Chat", hint: "Task-bound conversation" },
  { type: "preview", label: "Preview", hint: "Live app preview" },
  { type: "files", label: "Files", hint: "Workspace file tree" },
  { type: "terminal", label: "Terminal", hint: "PTY session" },
  { type: "inspector", label: "Inspector", hint: "Workspace inspector" },
  { type: "activity", label: "Activity", hint: "Run telemetry" },
  { type: "browser", label: "Browser", hint: "Browser jobs" },
  { type: "media", label: "Media", hint: "Media workspace" },
  { type: "plan", label: "Plan", hint: "Mission plan surface" },
  { type: "code", label: "Code", hint: "Code workspace" },
  { type: "canvas", label: "Canvas", hint: "Visual builder" },
];

/** Chat supports multiple windows per task; everything else is
    singleton-per-task (reopening focuses the existing window). */
const MULTI_INSTANCE: ReadonlySet<StudioWindowType> = new Set(["chat"]);

export default function StudioCanvas({
  projectId,
  storageKey,
  renderWindowContent,
  onOpenTool,
  onResetWorkspace,
  resolveTaskTitle,
}: {
  projectId: string | null;
  /** localStorage key for the persisted pan/zoom transform. */
  storageKey: string;
  /** Maps a window record to its tool surface. */
  renderWindowContent: (win: StudioWindow) => ReactNode;
  /** Called when the user picks a tool from the launcher. The caller
      resolves the task binding and calls manager.openWindow. */
  onOpenTool: (type: StudioWindowType) => void;
  onResetWorkspace: () => void;
  /** Resolves the durable task title shown in a window's titlebar. */
  resolveTaskTitle?: (taskId: string) => string | undefined;
}) {
  const windows = useProjectWindows(projectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the launcher menu on outside press / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const minimized = windows.filter((w) => w.state.minimized);
  const visible = windows.filter((w) => !w.state.minimized);

  return (
    <div className="studio-canvas-root">
      <StudioCanvasViewport enabled storageKey={storageKey}>
        {/* The pannable/zoomable world — windows live on it. */}
        <div className="studio-canvas" data-testid="studio-canvas">
          {windows.map((win) => (
            <StudioWindowFrame key={win.id} windowId={win.id} taskLabel={resolveTaskTitle?.(win.taskId)}>
              {renderWindowContent(win)}
            </StudioWindowFrame>
          ))}
        </div>
      </StudioCanvasViewport>

      {/* Chrome below stays fixed while the world pans/zooms. */}

      {/* Launcher — always reachable above the window stack. */}
      <div className="studio-canvas__launcher" ref={menuRef}>
        <button
          type="button"
          className="studio-canvas__launcher-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          data-testid="studio-new-window"
        >
          <Plus size={12} className="pointer-events-none" />
          New Window
        </button>
        {menuOpen && (
          <div className="studio-canvas__menu" role="menu" aria-label="Open a tool window">
            {STUDIO_WINDOW_MENU.map((item) => (
              <button
                key={item.type}
                type="button"
                role="menuitem"
                className="studio-canvas__menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenTool(item.type);
                }}
                data-testid={`studio-open-${item.type}`}
              >
                <span className="studio-canvas__menu-label">{item.label}</span>
                <span className="studio-canvas__menu-hint">{item.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Empty state — the canvas is visibly blank, not a hidden page. */}
      {windows.length === 0 && (
        <div className="studio-canvas__empty">
          <p className="studio-canvas__empty-title">Blank canvas</p>
          <p className="studio-canvas__empty-sub">
            Compose your own workspace — every tool is an independent window bound to a task.
          </p>
          <button
            type="button"
            className="studio-canvas__empty-btn"
            onClick={() => setMenuOpen(true)}
            data-testid="studio-canvas-open-tool"
          >
            <Plus size={13} className="pointer-events-none" />
            Open a tool
          </button>
        </div>
      )}

      {/* Taskbar — minimized windows + workspace reset. Only rendered when
          there's something to restore or reset. */}
      {windows.length > 0 && (
        <div className="studio-taskbar" data-testid="studio-taskbar">
          <div className="studio-taskbar__windows">
            {minimized.map((win) => (
              <MinimizedChip key={win.id} win={win} />
            ))}
            {minimized.length === 0 && (
              <span className="studio-taskbar__hint">
                {visible.length} window{visible.length === 1 ? "" : "s"} open
              </span>
            )}
          </div>
          <button
            type="button"
            className="studio-taskbar__reset"
            onClick={onResetWorkspace}
            title="Reset workspace layout (does not delete tasks, files, or conversations)"
            data-testid="studio-reset-workspace"
          >
            <RotateCcw size={11} className="pointer-events-none" />
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function MinimizedChip({ win }: { win: StudioWindow }) {
  const title = win.title || STUDIO_WINDOW_TITLES[win.type];
  return (
    <button
      type="button"
      className="studio-taskbar__chip"
      onClick={() => useStudioWindowStore.getState().restoreWindow(win.id)}
      title={`Restore ${title}`}
      data-testid={`studio-taskbar-${win.id}`}
    >
      {title}
    </button>
  );
}

export { MULTI_INSTANCE as STUDIO_MULTI_INSTANCE_TYPES };
