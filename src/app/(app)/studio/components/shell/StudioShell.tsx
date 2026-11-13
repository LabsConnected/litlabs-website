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
  leftPanel,
  leftWidth,
  onResetLeftWidth,
  dockHandle,
  filesPanel,
  bottomPanel,
  previewPanel,
  previewPanelOpen,
  onTogglePreviewPanel,
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
  /** Left-docked LiTT panel — the only chat surface — kept mounted
      while focus mode is active. */
  leftPanel?: ReactNode;
  /** Width of leftPanel, from the same hook that sizes the panel itself. */
  leftWidth: number;
  /** Reset the single source of truth for the chat width. */
  onResetLeftWidth: () => void;
  /** The LiTTPanel-owned resize handle; this is the only chat resize control. */
  dockHandle?: ReactNode;
  /** Phase 2 — the Files sidebar (real project files), mounted in its
      own slot BESIDE the chat panel. Collapsible + resizable; the
      shell owns its open state and width, persisted with the layout. */
  filesPanel?: ReactNode;
  /** Phase 2 — bottom panel slot (StudioDock: terminal, output,
      activity). Rendered under the workspace row, full width. */
  bottomPanel?: ReactNode;
  /** Phase 2 — the live, dockable Preview panel (the same
      StudioPreviewPanel as the Preview stage). Rendered on the right
      of the stage when open, so changes are visible while working in
      Canvas & Design or Code without switching stages. */
  previewPanel?: ReactNode;
  /** Controlled preview-panel visibility, owned by CommandStudio. */
  previewPanelOpen?: boolean;
  onTogglePreviewPanel?: () => void;
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

  // Phase 2 slots — Files sidebar + dockable Preview panel geometry.
  // Persisted in the same layout record as the inspector so one Reset
  // restores the whole frame. Files defaults OPEN (Directive §2: the
  // Files panel sits beside Chat); the Preview panel defaults closed
  // and is toggled from the layout toolbar.
  const [filesOpen, setFilesOpen] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("litt-studio-layout") ?? "{}").filesOpen;
      return typeof saved === "boolean" ? saved : true;
    } catch {
      return true;
    }
  });
  const [filesWidth, setFilesWidth] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("litt-studio-layout") ?? "{}").files;
      return typeof saved === "number" ? Math.max(240, Math.min(480, saved)) : 288;
    } catch {
      return 288;
    }
  });
  const filesWidthRef = useRef(filesWidth);
  const [previewWidth, setPreviewWidth] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("litt-studio-layout") ?? "{}").preview;
      return typeof saved === "number" ? Math.max(280, Math.min(640, saved)) : 360;
    } catch {
      return 360;
    }
  });
  const previewWidthRef = useRef(previewWidth);

  useEffect(() => {
    try {
      localStorage.setItem(
        "litt-studio-layout",
        JSON.stringify({
          inspector: inspectorWidth,
          floating,
          expanded: workspaceExpanded,
          files: filesWidth,
          filesOpen,
          preview: previewWidth,
        }),
      );
    } catch {
      // Storage may be unavailable in private or embedded browser contexts.
    }
  }, [inspectorWidth, floating, workspaceExpanded, filesWidth, filesOpen, previewWidth]);

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
    setFilesWidth(288);
    setFilesOpen(true);
    setPreviewWidth(360);
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

  useEffect(() => {
    filesWidthRef.current = filesWidth;
  }, [filesWidth]);

  useEffect(() => {
    previewWidthRef.current = previewWidth;
  }, [previewWidth]);

  // Files panel widens to the RIGHT (it sits left of the stage).
  const onFilesHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setFilesWidth((v) => Math.min(480, v + 10));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFilesWidth((v) => Math.max(240, v - 10));
    } else if (e.key === "Home") {
      e.preventDefault();
      setFilesWidth(480);
    } else if (e.key === "End") {
      e.preventDefault();
      setFilesWidth(240);
    }
  }, []);

  const onFilesMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = filesWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(240, Math.min(480, startW + ev.clientX - startX));
      filesWidthRef.current = next;
      setFilesWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Preview panel widens to the LEFT (it sits right of the stage) —
  // same geometry as the inspector handle.
  const onPreviewHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPreviewWidth((v) => Math.min(640, v + 10));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPreviewWidth((v) => Math.max(280, v - 10));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPreviewWidth(640);
    } else if (e.key === "End") {
      e.preventDefault();
      setPreviewWidth(280);
    }
  }, []);

  const onPreviewMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = previewWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(280, Math.min(640, startW + startX - ev.clientX));
      previewWidthRef.current = next;
      setPreviewWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

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
  const hasFiles = Boolean(filesPanel);
  const showFiles = hasFiles && filesOpen && !workspaceExpanded;
  const showPreviewPanel = Boolean(previewPanel) && Boolean(previewPanelOpen) && !workspaceExpanded;
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
          className="min-h-8 rounded-md border px-3 text-xs font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" style={{ borderColor: "var(--studio-border)", color: "var(--text-main)" }}
          data-testid="dock-float-toggle"
        >
          {!inspectorOpen ? "Inspector" : isFloating ? "Dock inspector" : "Float inspector"}
        </button>
        {hasFiles && (
          <button
            type="button"
            onClick={() => setFilesOpen((v) => !v)}
            aria-pressed={filesOpen}
            aria-label={filesOpen ? "Hide project files" : "Show project files"}
            title={filesOpen ? "Hide project files" : "Show project files"}
            className="min-h-8 rounded-md border px-3 text-xs font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" style={{ borderColor: "var(--studio-border)", color: "var(--text-main)" }}
            data-testid="dock-files-toggle"
          >
            {filesOpen ? "Hide files" : "Files"}
          </button>
        )}
        {onTogglePreviewPanel && (
          <button
            type="button"
            onClick={onTogglePreviewPanel}
            aria-pressed={Boolean(previewPanelOpen)}
            aria-label={previewPanelOpen ? "Hide live preview panel" : "Show live preview panel"}
            title={previewPanelOpen ? "Hide live preview panel" : "Show live preview panel"}
            className="min-h-8 rounded-md border px-3 text-xs font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" style={{ borderColor: "var(--studio-border)", color: "var(--text-main)" }}
            data-testid="dock-preview-toggle"
          >
            {previewPanelOpen ? "Hide preview" : "Preview panel"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setWorkspaceExpanded((v) => !v)}
          aria-pressed={workspaceExpanded}
          aria-label={workspaceExpanded ? "Exit focus workspace" : "Expand workspace"}
          title={workspaceExpanded ? "Exit focus workspace" : "Expand workspace"}
          className="min-h-8 rounded-md border px-3 text-xs font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" style={{ borderColor: "var(--studio-border)", color: "var(--text-main)" }}
          data-testid="studio-expand-toggle"
        >
          {workspaceExpanded ? "Exit focus" : "Expand workspace"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          aria-label="Reset workspace layout"
          title="Reset workspace layout"
          className="min-h-8 rounded-md border px-3 text-xs font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" style={{ borderColor: "var(--studio-border)", color: "var(--text-main)" }}
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

      <div className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden px-2 pb-2">
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

        {showFiles && (
          <>
            <div
              role="complementary"
              aria-label="Project files"
              style={{ width: filesWidth, minWidth: 240, maxWidth: 480 }}
              className="shrink-0 overflow-hidden rounded-xl border"
              data-testid="studio-files-panel"
            >
              {filesPanel}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize files panel"
              aria-valuemin={240}
              aria-valuemax={480}
              aria-valuenow={filesWidth}
              tabIndex={0}
              onKeyDown={onFilesHandleKeyDown}
              onMouseDown={onFilesMouseDown}
              data-testid="dock-resize-files"
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              <span className="h-8 w-0.5 rounded-full bg-[var(--studio-border-strong)]" aria-hidden="true" />
            </div>
          </>
        )}

        <div
          className="flex h-14 shrink-0 flex-col overflow-hidden"
          style={{ minWidth: 56, width: 56, display: workspaceExpanded ? "none" : undefined }}
          data-testid="studio-rail-slot"
        >
          {rail}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border" style={{ borderColor: "var(--studio-border)", background: "var(--studio-surface)" }} data-testid="studio-stage">
          {stage}
        </div>

        {showPreviewPanel && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize preview panel"
              aria-valuemin={280}
              aria-valuemax={640}
              aria-valuenow={previewWidth}
              tabIndex={0}
              onKeyDown={onPreviewHandleKeyDown}
              onMouseDown={onPreviewMouseDown}
              data-testid="dock-resize-preview"
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              <span className="h-8 w-0.5 rounded-full bg-[var(--studio-border-strong)]" aria-hidden="true" />
            </div>
            <div
              role="complementary"
              aria-label="Live preview"
              style={{ width: previewWidth, minWidth: 280, maxWidth: 640 }}
              className="shrink-0 overflow-hidden rounded-xl border"
              data-testid="dock-preview-panel"
            >
              {previewPanel}
            </div>
          </>
        )}

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
                className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                <span className="h-8 w-0.5 rounded-full bg-[var(--studio-border-strong)]" aria-hidden="true" />
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

      {bottomPanel}

      {isFloating && hasInspector && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Floating inspector"
          data-testid="floating-inspector"
          className="absolute right-3 top-16 z-50 flex max-h-[calc(100vh-96px)] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border shadow-xl"
          style={{
            width: `min(${inspectorWidth}px, calc(100vw - 24px))`,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100vh - 96px)",
            borderColor: "var(--studio-border)",
            background: "var(--studio-surface)",
            color: "var(--text-main)",
          }}
        >
          <div className="flex min-h-10 shrink-0 items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
            <span className="text-xs font-semibold">Inspector · floating</span>
            <button
              type="button"
              onClick={() => setFloating(null)}
              aria-label="Dock floating inspector"
              className="min-h-8 rounded-md px-3 text-xs hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              Dock inspector
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" role="complementary" aria-label="Inspector (floating)">
            {inspector}
          </div>
        </div>
      )}

    </div>
  );
}
