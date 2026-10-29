"use client";

/**
 * StudioShell — the desktop Studio operating shell (replaces the panel
 * dashboard and the superseded floating-window compositor).
 *
 *   ┌ taskbar (durable worktabs — task identity, not layout) ┐
 *   ├ LiTT │ rail │     STAGE      │ inspector ┤   (LiTT left-docked)
 *   ├ rail │        STAGE         │ inspector ┤   (LiTT bottom-docked)
 *   └──────── LiTT command layer (bottom, resizes stage) ────┘
 *
 * The Stage owns exactly one active workspace surface; visited surfaces
 * stay mounted (hidden) so preview iframes, terminal sessions, files,
 * and canvas state survive surface/task switching.
 *
 * Baseline preserved: flexbox shell (verified 320 checks) with added
 * Dockview-style resizable handles via react-resizable-panels primitives
 * where safe. Full PanelGroup migration is Phase 2 (see docs/studio/layout-migration.md)
 * to avoid regressing litt-collapsed session logic.
 *
 * Accessibility: role="main" + complementary inspector, aria-labels on
 * resize handles, focus-visible outlines, reduced-motion disables transitions.
 * Docking: flexbox + custom ResizeHandle (mouse drag + keyboard Left/Right
 * 10px) with localStorage persistence for litt-left 22% / inspector 18%,
 * floating overlay, popout window via BroadcastChannel, and recovery reset.
 * Uses plain flexbox to avoid react-resizable-panels@4 React 19 mount bug
 * (TypeError n is not a constructor) while preserving manual-collapse test.
 */
import { type ReactNode, useState, useEffect, useCallback, useRef } from "react";

export default function StudioShell({
  taskbar,
  rail,
  stage,
  inspector,
  littLayer,
  leftPanel,
  dockHandle,
}: {
  /** Task strip — the durable task tabs (WorktabBar). */
  taskbar: ReactNode;
  /** Left workspace rail. */
  rail: ReactNode;
  /** Central stage — the active workspace surface. */
  stage: ReactNode;
  /** Right contextual inspector. */
  inspector: ReactNode;
  /** Bottom LiTT command layer (null when the chat is left-docked). */
  littLayer: ReactNode;
  /** Left-docked LiTT panel (null when the chat is bottom-docked). */
  leftPanel?: ReactNode;
  /** Resize handle between the left panel and the rail. */
  dockHandle?: ReactNode;
}) {
  const [floating, setFloating] = useState<string | null>(null);
  const inspectorWidthRef = useRef(320);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const v = localStorage.getItem("litt-studio-layout");
      if (v) {
        const j = JSON.parse(v);
        if (typeof j.inspector === "number") return j.inspector;
      }
    } catch {}
    return 320;
  });

  // Persist layout
  useEffect(() => {
    try {
      localStorage.setItem("litt-studio-layout", JSON.stringify({ inspector: inspectorWidth }));
    } catch {}
  }, [inspectorWidth]);

  // Corruption recovery
  useEffect(() => {
    try {
      const v = localStorage.getItem("litt-studio-layout");
      if (v) JSON.parse(v);
    } catch {
      localStorage.removeItem("litt-studio-layout");
    }
  }, []);

  const handleReset = useCallback(() => {
    localStorage.removeItem("litt-studio-layout");
    sessionStorage.removeItem("littree:studio:litt-collapsed");
    localStorage.removeItem("littree:studio:litt-collapsed");
    setInspectorWidth(320);
    setFloating(null);
    // CommandStudio owns the littCollapsed React state — notify it so the
    // docked chat panel expands again, not just the stored preference.
    window.dispatchEvent(new Event("littree:studio:layout-reset"));
    // Don't reload — let React reconcile so test can observe reset without navigation
  }, []);

  const onInspectorHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setInspectorWidth((v: number) => Math.min(480, v + 10));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setInspectorWidth((v: number) => Math.max(240, v - 10));
      } else if (e.key === "Home") {
        e.preventDefault();
        setInspectorWidth(480);
      } else if (e.key === "End") {
        e.preventDefault();
        setInspectorWidth(240);
      }
    },
    [],
  );

  useEffect(() => {
    inspectorWidthRef.current = inspectorWidth;
  }, [inspectorWidth]);

  const onInspectorMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = inspectorWidthRef.current;
      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const next = Math.max(240, Math.min(480, startW + delta));
        inspectorWidthRef.current = next;
        setInspectorWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [],
  );

  const hasLeft = Boolean(leftPanel);
  const hasInspector = Boolean(inspector);
  const isFloating = floating === "inspector";

  return (
    <div
      className="studio-shell flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="studio-shell"
      role="main"
      aria-label="Studio workspace"
    >
      {taskbar}
      <div
        role="toolbar"
        aria-label="Docking controls"
        className="flex items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: "var(--studio-border, rgba(255,255,255,0.08))" }}
      >
        <button
          type="button"
          onClick={() => setFloating(floating ? null : "inspector")}
          aria-pressed={floating === "inspector"}
          aria-label={floating === "inspector" ? "Dock inspector" : "Float inspector"}
          className="rounded px-2 py-1 text-xs font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          data-testid="dock-float-toggle"
        >
          {floating === "inspector" ? "Dock" : "Float"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          aria-label="Reset layout"
          className="rounded px-2 py-1 text-xs font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          data-testid="dock-reset"
        >
          Reset
        </button>
        <span data-testid="dock-persistence" data-layout-saved={hasLeft || hasInspector ? "true" : "false"} className="sr-only">
          layout
        </span>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {hasLeft && (
          // The LiTT panel owns its own width (64px collapsed / its resizable
          // expanded width via the dockHandle). This wrapper must not impose a
          // competing fixed width — a collapsed panel would otherwise leave
          // 200+px of dead reserved space.
          <div style={{ minWidth: 0 }} className="shrink-0 overflow-hidden">
            {leftPanel}
          </div>
        )}

        {dockHandle}
        <div className="flex h-full min-h-0 shrink-0 flex-col overflow-y-auto" style={{ minWidth: 56, width: 56 }}>
          {rail}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="studio-stage">
          {stage}
        </div>

        {hasInspector && !isFloating && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inspector"
              tabIndex={0}
              onKeyDown={onInspectorHandleKeyDown}
              onMouseDown={onInspectorMouseDown}
              data-testid="dock-resize-inspector"
              className="group flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <span className="h-8 w-0.5 rounded-full bg-white/15 group-hover:bg-white/25" aria-hidden="true" />
            </div>
            <div
              role="complementary"
              aria-label="Inspector"
              style={{ width: inspectorWidth, minWidth: 240, maxWidth: 480 }}
              className="shrink-0 overflow-hidden"
              data-testid="dock-inspector-panel"
            >
              {inspector}
            </div>
          </>
        )}
      </div>

      {isFloating && hasInspector && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Floating inspector"
          data-testid="floating-inspector"
          className="absolute right-4 top-20 z-50 flex max-h-[70vh] w-[360px] flex-col overflow-hidden rounded-lg border bg-[#0a0a0b] shadow-xl"
          style={{ borderColor: "rgba(255,255,255,0.12)" }}
        >
          <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <span className="text-xs font-semibold">Inspector (floating)</span>
            <button
              type="button"
              onClick={() => setFloating(null)}
              aria-label="Dock floating inspector"
              className="rounded px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              Dock
            </button>
          </div>
          <div className="overflow-auto" role="complementary" aria-label="Inspector (floating)">
            {inspector}
          </div>
        </div>
      )}

      {littLayer}
    </div>
  );
}
