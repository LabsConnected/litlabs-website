"use client";

/**
 * StudioWindowFrame — the one shared window chrome for the Studio canvas.
 *
 * Pure view over a `StudioWindow` record in useStudioWindowStore:
 * drag, resize (8 directions), minimize/maximize/dock/close, z-order,
 * focus, and persisted geometry all live in the manager — never here.
 *
 * The window stays MOUNTED while minimized (display:none) so iframes,
 * PTY sessions, and scroll state survive. `closeWindow` deletes the
 * record, which is what actually unmounts the tool surface.
 */

import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import {
  Activity,
  Clapperboard,
  ClipboardList,
  Code2,
  Eye,
  FolderOpen,
  Globe,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  Minus,
  ScanSearch,
  SquareTerminal,
  X,
} from "lucide-react";
import { useStudioWindowStore, useStudioWindow } from "../stores/useStudioWindowStore";
import { useStudioCanvasZoom } from "./StudioCanvasViewport";
import type { StudioWindowType } from "../types/studio-windows";

const TYPE_ICONS: Record<StudioWindowType, typeof MessageSquare> = {
  chat: MessageSquare,
  preview: Eye,
  files: FolderOpen,
  terminal: SquareTerminal,
  inspector: ScanSearch,
  activity: Activity,
  browser: Globe,
  media: Clapperboard,
  plan: ClipboardList,
  code: Code2,
  canvas: LayoutGrid,
};

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

type DragState = {
  mode: "move" | `resize-${ResizeDir}`;
  pointerId: number;
  startX: number;
  startY: number;
  bounds: { x: number; y: number; width: number; height: number };
};

export default function StudioWindowFrame({
  windowId,
  taskLabel,
  minWidth = 280,
  minHeight = 200,
  className = "",
  headerExtra,
  children,
}: {
  windowId: string;
  /** Task name shown beside the title (resolved by the caller). */
  taskLabel?: string;
  minWidth?: number;
  minHeight?: number;
  className?: string;
  /** Extra controls rendered in the titlebar (e.g. a device picker). */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const win = useStudioWindow(windowId);
  const focused = useStudioWindowStore((s) => s.activeWindowId === windowId);
  const zoom = useStudioCanvasZoom();
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<HTMLElement>(null);

  const manager = useStudioWindowStore.getState();

  const stopPointer = useCallback(() => {
    dragRef.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  useEffect(() => () => stopPointer(), [stopPointer]);

  // Escape restores a maximized window — scoped to the focused window so it
  // never interferes with other surfaces.
  useEffect(() => {
    if (!focused || !win?.state.maximized) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "Escape") {
        e.preventDefault();
        useStudioWindowStore.getState().maximizeWindow(windowId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focused, win?.state.maximized, windowId]);

  if (!win) return null;

  const { bounds, zIndex, state } = win;

  const startPointer = (event: PointerEvent<HTMLElement>, mode: DragState["mode"]) => {
    if (event.button !== 0 || state.maximized || state.docked) return;
    manager.focusWindow(windowId);
    dragRef.current = { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, bounds };
    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "move" ? "grabbing" : `${mode === "resize-n" || mode === "resize-s" ? "ns" : mode === "resize-e" || mode === "resize-w" ? "ew" : mode === "resize-ne" || mode === "resize-sw" ? "nesw" : "nwse"}-resize`;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Pointer deltas are in screen space; window bounds live on the zoomed
    // canvas surface — divide by zoom so 1px of pointer = 1px of canvas.
    const dx = (event.clientX - drag.startX) / (zoom || 1);
    const dy = (event.clientY - drag.startY) / (zoom || 1);
    const b = drag.bounds;
    let next = { ...b };

    if (drag.mode === "move") {
      next = { ...b, x: b.x + dx, y: b.y + dy };
    } else {
      const dir = drag.mode.replace("resize-", "") as ResizeDir;
      if (dir.includes("e")) next.width = b.width + dx;
      if (dir.includes("s")) next.height = b.height + dy;
      if (dir.includes("w")) { next.x = b.x + dx; next.width = b.width - dx; }
      if (dir.includes("n")) { next.y = b.y + dy; next.height = b.height - dy; }
      // Local min-size enforcement: clamp x/y so the anchored edge doesn't
      // jump when the opposite edge hits minWidth/minHeight.
      if (dir.includes("w") && next.width < minWidth) { next.x += next.width - minWidth; next.width = minWidth; }
      if (dir.includes("n") && next.height < minHeight) { next.y += next.height - minHeight; next.height = minHeight; }
      next.width = Math.max(minWidth, next.width);
      next.height = Math.max(minHeight, next.height);
    }
    useStudioWindowStore.getState().updateBounds(windowId, next);
  };

  const Icon = TYPE_ICONS[win.type];
  const isDockedOrMax = state.maximized || Boolean(state.docked);

  return (
    <section
      ref={frameRef}
      className={`studio-freeform-window ${focused ? "studio-freeform-window--focused" : ""} ${state.minimized ? "studio-freeform-window--minimized" : ""} ${state.maximized ? "studio-freeform-window--maximized" : ""} ${state.docked ? `studio-freeform-window--docked-${state.docked}` : ""} ${className}`}
      data-studio-window={windowId}
      data-window-type={win.type}
      data-task-id={win.taskId}
      style={isDockedOrMax ? { zIndex } : { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, zIndex }}
      onPointerDownCapture={() => {
        if (!focused) useStudioWindowStore.getState().focusWindow(windowId);
      }}
      aria-label={win.title}
      role="dialog"
    >
      <div
        className="studio-freeform-window__grab"
        data-studio-window-grab
        aria-label={`Move ${win.title} window`}
        role="button"
        tabIndex={0}
        onPointerDown={(event) => startPointer(event, "move")}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
        onDoubleClick={() => manager.maximizeWindow(windowId)}
      >
        <Icon size={12} className="pointer-events-none shrink-0" style={{ color: "var(--color-accent)" }} />
        <span className="studio-freeform-window__title">{win.title}</span>
        {taskLabel && taskLabel !== win.title ? (
          <span className="studio-freeform-window__task" title={`Task: ${taskLabel}`}>{taskLabel}</span>
        ) : null}
        {headerExtra}
        <span className="studio-freeform-window__controls">
          <button
            type="button"
            aria-label={`Minimize ${win.title}`}
            title="Minimize"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useStudioWindowStore.getState().minimizeWindow(windowId)}
          >
            <Minus size={12} className="pointer-events-none" />
          </button>
          <button
            type="button"
            aria-label={state.maximized ? `Restore ${win.title}` : `Maximize ${win.title}`}
            title={state.maximized ? "Restore (Esc)" : "Maximize"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useStudioWindowStore.getState().maximizeWindow(windowId)}
          >
            <Maximize2 size={11} className="pointer-events-none" />
          </button>
          <button
            type="button"
            aria-label={`Close ${win.title}`}
            title="Close"
            data-testid="studio-window-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useStudioWindowStore.getState().closeWindow(windowId)}
          >
            <X size={12} className="pointer-events-none" />
          </button>
        </span>
      </div>
      <div className="studio-freeform-window__body">{children}</div>
      {!isDockedOrMax && RESIZE_DIRS.map((dir) => (
        <div
          key={dir}
          className={`studio-freeform-window__rh studio-freeform-window__rh--${dir}`}
          data-studio-window-resize={dir}
          aria-hidden
          onPointerDown={(event) => startPointer(event, `resize-${dir}`)}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPointer}
          onPointerCancel={stopPointer}
        />
      ))}
    </section>
  );
}
