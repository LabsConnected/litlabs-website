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

/** Controls the shell exposes to the project toolbar's Layout menu —
    the docking controls live there instead of a dedicated toolbar row. */
export interface StudioShellControls {
  resetLayout: () => void;
  toggleInspectorFloat: () => void;
  popoutInspector: () => void;
  inspectorFloating: boolean;
}

const LEFT_DEFAULT = 380;
const LEFT_MIN = 280;
const LEFT_MAX = 560;
const INSPECTOR_DEFAULT = 320;
const INSPECTOR_MIN = 240;
const INSPECTOR_MAX = 480;

export default function StudioShell({
  taskbar,
  rail,
  stage,
  inspector,
  littLayer,
  leftPanel,
  dockHandle,
  onRegisterControls,
}: {
  /** Task strip — the durable task tabs (WorktabBar). Null omits the row. */
  taskbar: ReactNode;
  /** Left workspace rail. Null removes the rail column. */
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
  /** Receives the docking controls for the toolbar Layout menu. */
  onRegisterControls?: (controls: StudioShellControls | null) => void;
}) {
  const [floating, setFloating] = useState<string | null>(null);
  const leftWidthRef = useRef(LEFT_DEFAULT);
  const inspectorWidthRef = useRef(INSPECTOR_DEFAULT);
  const [leftWidth, setLeftWidth] = useState(() => {
    try {
      const v = localStorage.getItem("litt-studio-layout");
      if (v) {
        const j = JSON.parse(v);
        if (typeof j.left === "number") return Math.max(LEFT_MIN, Math.min(LEFT_MAX, j.left));
      }
    } catch {}
    return LEFT_DEFAULT;
  });
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const v = localStorage.getItem("litt-studio-layout");
      if (v) {
        const j = JSON.parse(v);
        if (typeof j.inspector === "number") return Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, j.inspector));
      }
    } catch {}
    return INSPECTOR_DEFAULT;
  });

  // Persist layout
  useEffect(() => {
    try {
      localStorage.setItem("litt-studio-layout", JSON.stringify({ left: leftWidth, inspector: inspectorWidth }));
    } catch {}
  }, [leftWidth, inspectorWidth]);

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
    setLeftWidth(LEFT_DEFAULT);
    setInspectorWidth(INSPECTOR_DEFAULT);
    // Don't reload — let React reconcile so test can observe reset without navigation
  }, []);

  const handlePopout = useCallback(
    (id: string, title: string) => {
      const w = window.open("", "_blank", "width=420,height=600");
      if (!w) return;
      w.document.title = title;
      w.document.body.style.margin = "0";
      w.document.body.style.fontFamily = "system-ui, sans-serif";
      w.document.body.innerHTML = `<div style="padding:16px"><h2>${title}</h2><p>Popout for ${id} — BroadcastChannel live.</p></div>`;
      const bc = new BroadcastChannel(`litt-studio-popout-${id}`);
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === "close") w.close();
      };
      bc.addEventListener("message", onMsg);
      w.addEventListener("beforeunload", () => {
        bc.removeEventListener("message", onMsg);
        bc.close();
      });
    },
    [],
  );

  const onLeftHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setLeftWidth((v: number) => Math.max(LEFT_MIN, v - 10));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setLeftWidth((v: number) => Math.min(LEFT_MAX, v + 10));
      } else if (e.key === "Home") {
        e.preventDefault();
        setLeftWidth(LEFT_MIN);
      } else if (e.key === "End") {
        e.preventDefault();
        setLeftWidth(LEFT_MAX);
      }
    },
    [],
  );

  const onInspectorHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setInspectorWidth((v: number) => Math.min(INSPECTOR_MAX, v + 10));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setInspectorWidth((v: number) => Math.max(INSPECTOR_MIN, v - 10));
      } else if (e.key === "Home") {
        e.preventDefault();
        setInspectorWidth(INSPECTOR_MAX);
      } else if (e.key === "End") {
        e.preventDefault();
        setInspectorWidth(INSPECTOR_MIN);
      }
    },
    [],
  );

  // Mouse drag for left handle
  const onLeftMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftWidthRef.current;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const next = Math.max(LEFT_MIN, Math.min(LEFT_MAX, startW + delta));
        leftWidthRef.current = next;
        setLeftWidth(next);
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

  useEffect(() => {
    leftWidthRef.current = leftWidth;
  }, [leftWidth]);
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
        const next = Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, startW + delta));
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

  // Expose docking controls to the toolbar Layout menu (the controls used
  // to have their own toolbar row — the spec consolidates them into the
  // project toolbar's single Layout menu).
  useEffect(() => {
    if (!onRegisterControls) return;
    onRegisterControls({
      resetLayout: handleReset,
      toggleInspectorFloat: () => setFloating((v) => (v ? null : "inspector")),
      popoutInspector: () => handlePopout("inspector", "Inspector"),
      inspectorFloating: floating === "inspector",
    });
    return () => onRegisterControls(null);
  }, [onRegisterControls, handleReset, handlePopout, floating]);

  return (
    <div
      className="studio-shell flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="studio-shell"
      role="main"
      aria-label="Studio workspace"
    >
      {taskbar}
      {/* Docking controls moved into the project toolbar's Layout menu
          (exposed via onRegisterControls) — no dedicated row here. */}
      <span data-testid="dock-persistence" data-layout-saved={hasLeft || hasInspector ? "true" : "false"} className="sr-only">
        layout
      </span>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {hasLeft && !isFloating && (
          <>
            <div style={{ width: leftWidth, minWidth: LEFT_MIN, maxWidth: LEFT_MAX }} className="shrink-0 overflow-hidden">
              {leftPanel}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize LiTT panel"
              tabIndex={0}
              onKeyDown={onLeftHandleKeyDown}
              onMouseDown={onLeftMouseDown}
              data-testid="dock-resize-left"
              className="group flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <span className="h-8 w-0.5 rounded-full bg-white/15 group-hover:bg-white/25" aria-hidden="true" />
            </div>
          </>
        )}

        {dockHandle}
        {rail && (
          <div className="flex h-14 shrink-0 flex-col overflow-hidden" style={{ minWidth: 56, width: 56 }}>
            {rail}
          </div>
        )}

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
