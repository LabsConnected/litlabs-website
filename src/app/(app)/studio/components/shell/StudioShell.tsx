"use client";

/**
 * StudioShell — desktop workspace frame.
 *
 * Chat width is controlled by CommandStudio's persistent resize hook so the
 * panel and its outer flex slot can never drift apart. A closed inspector keeps
 * only its compact open button in the layout. Focus mode hides side panels
 * without unmounting them, preserving chat drafts, preview state, and sessions.
 */
import { type ReactNode, useState, useEffect, useCallback, useRef } from "react";

export default function StudioShell({
  taskbar,
  rail,
  stage,
  inspector,
  inspectorOpen,
  onOpenInspector,
  littLayer,
  leftPanel,
  leftWidth,
  onResetLeftWidth,
  dockHandle,
}: {
  /** Durable worktabs — task identity, not layout. */
  taskbar: ReactNode;
  /** Left workspace navigation rail. */
  rail: ReactNode;
  /** Active workspace surface. */
  stage: ReactNode;
  /** Contextual inspector content (also renders its compact closed toggle). */
  inspector: ReactNode;
  /** Controlled inspector visibility, shared with ContextInspector. */
  inspectorOpen: boolean;
  onOpenInspector: () => void;
  /** Bottom LiTT command layer (null when the chat is left-docked). */
  littLayer: ReactNode;
  /** Left-docked LiTT panel, kept mounted while focus mode is active. */
  leftPanel?: ReactNode;
  /** Width of leftPanel, from the same hook that sizes the panel itself. */
  leftWidth: number;
  /** Reset the single source of truth for the chat width. */
  onResetLeftWidth: () => void;
  /** The LiTTPanel-owned resize handle; this is the only chat resize control. */
  dockHandle?: ReactNode;
}) {
  const [floating, setFloating] = useState<"inspector" | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("litt-studio-layout") ?? "{}").floating === "inspector"
        ? "inspector"
        : null;
    } catch {
      return null;
    }
  });
  const [workspaceExpanded, setWorkspaceExpanded] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("litt-studio-layout") ?? "{}").expanded === true;
    } catch {
      return false;
    }
  });
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("litt-studio-layout") ?? "{}").inspector;
      return typeof saved === "number" ? Math.max(240, Math.min(480, saved)) : 320;
    } catch {
      return 320;
    }
  });
  const inspectorWidthRef = useRef(inspectorWidth);

  useEffect(() => {
    try {
      localStorage.setItem(
        "litt-studio-layout",
        JSON.stringify({ inspector: inspectorWidth, floating, expanded: workspaceExpanded }),
      );
    } catch {
      // Storage may be unavailable in private or embedded browser contexts.
    }
  }, [inspectorWidth, floating, workspaceExpanded]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("litt-studio-layout");
      if (saved) JSON.parse(saved);
    } catch {
      try {
        localStorage.removeItem("litt-studio-layout");
      } catch {
        // Ignore storage failures; the in-memory defaults remain usable.
      }
    }
  }, []);

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem("litt-studio-layout");
      sessionStorage.removeItem("littree:studio:litt-collapsed");
      localStorage.removeItem("littree:studio:litt-collapsed");
    } catch {
      // Reset the in-memory layout even if storage is unavailable.
    }
    onResetLeftWidth();
    setInspectorWidth(320);
    setFloating(null);
    setWorkspaceExpanded(false);
  }, [onResetLeftWidth]);

  const onInspectorHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setInspectorWidth((v) => Math.min(480, v + 10));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setInspectorWidth((v) => Math.max(240, v - 10));
    } else if (e.key === "Home") {
      e.preventDefault();
      setInspectorWidth(480);
    } else if (e.key === "End") {
      e.preventDefault();
      setInspectorWidth(240);
    }
  }, []);

  useEffect(() => {
    inspectorWidthRef.current = inspectorWidth;
  }, [inspectorWidth]);

  const onInspectorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = inspectorWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(240, Math.min(480, startW + startX - ev.clientX));
      inspectorWidthRef.current = next;
      setInspectorWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const hasLeft = Boolean(leftPanel);
  const hasInspector = Boolean(inspector);
  const isFloating = floating === "inspector" && inspectorOpen;
  const compactLeftWidth = leftWidth <= 64;

  return (
    <div
      className="studio-shell relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="studio-shell"
      data-layout-expanded={workspaceExpanded ? "true" : "false"}
      role="main"
      aria-label="Studio workspace"
    >
      {taskbar}
      <div
        role="toolbar"
        aria-label="Workspace layout controls"
        className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1.5"
        style={{ borderColor: "var(--studio-border, rgba(255,255,255,0.08))" }}
      >
        <button
          type="button"
          onClick={() => {
            if (!inspectorOpen) {
              setWorkspaceExpanded(false);
              onOpenInspector();
              return;
            }
            setFloating((v) => (v === "inspector" ? null : "inspector"));
          }}
          aria-pressed={isFloating}
          aria-label={!inspectorOpen ? "Open inspector" : isFloating ? "Dock inspector" : "Float inspector"}
          title={!inspectorOpen ? "Open inspector" : isFloating ? "Dock inspector" : "Float inspector"}
          className="min-h-8 rounded-md border border-white/10 px-3 text-xs font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          data-testid="dock-float-toggle"
        >
          {!inspectorOpen ? "Inspector" : isFloating ? "Dock inspector" : "Float inspector"}
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceExpanded((v) => !v)}
          aria-pressed={workspaceExpanded}
          aria-label={workspaceExpanded ? "Exit focus workspace" : "Expand workspace"}
          title={workspaceExpanded ? "Exit focus workspace" : "Expand workspace"}
          className="min-h-8 rounded-md border border-white/10 px-3 text-xs font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          data-testid="studio-expand-toggle"
        >
          {workspaceExpanded ? "Exit focus" : "Expand workspace"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          aria-label="Reset workspace layout"
          title="Reset workspace layout"
          className="min-h-8 rounded-md border border-white/10 px-3 text-xs font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          data-testid="dock-reset"
        >
          Reset layout
        </button>
        <span
          data-testid="dock-persistence"
          data-layout-saved={hasLeft || hasInspector ? "true" : "false"}
          className="sr-only"
        >
          layout
        </span>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {hasLeft && (
          <div
            data-testid="studio-left-panel"
            style={{
              width: leftWidth,
              minWidth: compactLeftWidth ? 64 : 300,
              maxWidth: compactLeftWidth ? 64 : "min(500px, 36vw)",
              display: workspaceExpanded ? "none" : undefined,
            }}
            className="shrink-0 overflow-hidden"
          >
            {leftPanel}
          </div>
        )}

        {!workspaceExpanded && dockHandle}

        <div
          className="flex h-14 shrink-0 flex-col overflow-hidden"
          style={{ minWidth: 56, width: 56, display: workspaceExpanded ? "none" : undefined }}
          data-testid="studio-rail-slot"
        >
          {rail}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="studio-stage">
          {stage}
        </div>

        {hasInspector && (
          <>
            {inspectorOpen && !isFloating && !workspaceExpanded && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize inspector"
                aria-valuemin={240}
                aria-valuemax={480}
                aria-valuenow={inspectorWidth}
                tabIndex={0}
                onKeyDown={onInspectorHandleKeyDown}
                onMouseDown={onInspectorMouseDown}
                data-testid="dock-resize-inspector"
                className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                <span className="h-8 w-0.5 rounded-full bg-white/15 group-hover:bg-white/25" aria-hidden="true" />
              </div>
            )}
            <div
              role="complementary"
              aria-label="Inspector"
              style={{
                width: inspectorOpen ? inspectorWidth : 20,
                minWidth: inspectorOpen ? 240 : 20,
                maxWidth: inspectorOpen ? 480 : 20,
                display: workspaceExpanded || isFloating ? "none" : undefined,
              }}
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
          className="absolute right-3 top-16 z-50 flex max-h-[calc(100vh-96px)] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border bg-[#0a0a0b] shadow-xl"
          style={{
            width: `min(${inspectorWidth}px, calc(100vw - 24px))`,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100vh - 96px)",
            borderColor: "rgba(255,255,255,0.12)",
          }}
        >
          <div className="flex min-h-10 shrink-0 items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <span className="text-xs font-semibold">Inspector · floating</span>
            <button
              type="button"
              onClick={() => setFloating(null)}
              aria-label="Dock floating inspector"
              className="min-h-8 rounded-md px-3 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Dock inspector
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" role="complementary" aria-label="Inspector (floating)">
            {inspector}
          </div>
        </div>
      )}

      <div style={{ display: workspaceExpanded ? "none" : undefined }} data-testid="studio-chat-layer-slot">
        {littLayer}
      </div>
    </div>
  );
}
