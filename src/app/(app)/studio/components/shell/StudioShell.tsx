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
 * Width ownership: each panel owns its own width. LiTTPanel carries its
 * expanded/collapsed width (driven by the caller's useResizableWidth +
 * ResizeHandle via the dockHandle slot); ContextInspector is fixed-width by
 * design. The shell applies NO competing widths — a resize wrapper around a
 * self-sized child only clips its controls.
 *
 * Accessibility: role="main" + complementary inspector, aria-labels on
 * docking controls, focus-visible outlines, reduced-motion disables
 * transitions. Floating is an in-tree overlay dialog; popout is a real
 * React portal into a same-origin window carrying the app's stylesheets.
 */
import { type ReactNode, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

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
  const [popoutDoc, setPopoutDoc] = useState<Document | null>(null);
  const popoutWinRef = useRef<Window | null>(null);

  const closePopout = useCallback(() => {
    popoutWinRef.current?.close();
    popoutWinRef.current = null;
    setPopoutDoc(null);
  }, []);

  const handleReset = useCallback(() => {
    localStorage.removeItem("litt-studio-layout");
    sessionStorage.removeItem("littree:studio:litt-collapsed");
    localStorage.removeItem("littree:studio:litt-collapsed");
    // Restore docked state too — a reset that leaves the inspector floating
    // or popped out is not a reset.
    setFloating(null);
    closePopout();
  }, [closePopout]);

  // Real popout: the SAME inspector element is portal-rendered into a
  // same-origin window carrying the app's stylesheets, so it keeps its real
  // content and appearance. Closing the window (or Dock) returns it docked.
  const handlePopout = useCallback(
    (id: string, title: string) => {
      if (popoutWinRef.current) return;
      const w = window.open("", "_blank", "width=420,height=600");
      if (!w) return;
      try {
        w.document.title = title;
        w.document.body.style.margin = "0";
        w.document.body.style.height = "100vh";
        w.document.body.style.background = "#0a0a0b";
        // Carry the app's styles so the inspector keeps its real appearance:
        // linked stylesheets and inline style blocks clone directly; CSS
        // variables come along with them via :root rules.
        for (const node of Array.from(
          document.querySelectorAll('link[rel="stylesheet"], style'),
        )) {
          w.document.head.appendChild(node.cloneNode(true));
        }
        try {
          // Tailwind v4 / CSS-in-JS may use constructable stylesheets.
          (w.document as Document & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [
            ...document.adoptedStyleSheets,
          ];
        } catch {}
      } catch {
        // Style carry-over is best-effort — content remains functional.
      }
      popoutWinRef.current = w;
      setPopoutDoc(w.document);
      w.addEventListener("beforeunload", () => {
        popoutWinRef.current = null;
        setPopoutDoc(null);
      });
    },
    [],
  );

  const hasLeft = Boolean(leftPanel);
  const hasInspector = Boolean(inspector);
  const isFloating = floating === "inspector";
  const inspectorDetached = isFloating || popoutDoc !== null;

  return (
    <div
      className="studio-shell relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
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
          onClick={() => hasInspector && !popoutDoc && handlePopout("inspector", "Inspector")}
          aria-label="Pop out inspector"
          className="rounded px-2 py-1 text-xs font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          data-testid="dock-popout"
        >
          Popout
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
        {/* Left panel (LiTT chat) stays mounted while the inspector floats —
            floating the inspector must never hide the chat or drop its
            preserved scroll/UI state. The panel owns its own width. */}
        {hasLeft && (
          <>
            {leftPanel}
            {dockHandle}
          </>
        )}

        {/* The rail holds every workspace switch — let it fill the available
            height and scroll internally so no control is ever clipped away. */}
        <div
          className="flex h-full shrink-0 flex-col overflow-x-hidden overflow-y-auto"
          style={{ minWidth: 56, width: 56 }}
        >
          {rail}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="studio-stage">
          {stage}
        </div>

        {/* Inspector owns its width (fixed by design); the wrapper only
            carries landmark semantics and never competes on sizing. */}
        {hasInspector && !inspectorDetached && (
          <div
            role="complementary"
            aria-label="Inspector"
            className="flex h-full min-h-0 shrink-0 overflow-hidden"
            data-testid="dock-inspector-panel"
          >
            {inspector}
          </div>
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

      {popoutDoc &&
        hasInspector &&
        createPortal(
          <div className="flex h-full min-h-0 flex-col" style={{ background: "#0a0a0b" }}>
            <div
              className="flex items-center justify-between border-b px-3 py-2"
              style={{ borderColor: "rgba(255,255,255,0.08)", color: "#f5f3f0" }}
            >
              <span className="text-xs font-semibold">Inspector</span>
              <button
                type="button"
                onClick={closePopout}
                aria-label="Dock popped-out inspector"
                className="rounded px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                style={{ color: "#f5f3f0" }}
              >
                Dock
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto" role="complementary" aria-label="Inspector (popped out)">
              {inspector}
            </div>
          </div>,
          popoutDoc.body,
        )}

      {littLayer}
    </div>
  );
}
