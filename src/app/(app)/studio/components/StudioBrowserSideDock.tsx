"use client";

/**
 * StudioBrowserSideDock — the Regular layout's Browser home
 * (rail consolidation, Larry 2026-11-25).
 *
 * The Browser is an ON-DEMAND side dock, never a permanent rail: it
 * renders only while open. It docks on the right by default and can
 * flip to the left — by the Flip button, or by dragging its header
 * across toward the other side. Side-by-side is the point: the user
 * controls the workspace and watches the browser at once, so in
 * docked mode the panel sits IN FLOW and the workspace narrows.
 *
 * Dragging (Larry's all-windows-draggable ruling, applied here):
 *   - Header drag, docked: drag across → the dock flips side.
 *   - Header drag, free: moves the floating panel anywhere inside
 *     the Studio body, clamped so it can never leave the screen.
 *   - The inner-edge divider drags to resize (300–720px, and never
 *     wider than 62% of the window), in both modes.
 * Pop-out switches to the free floating panel; Dock returns it.
 * Side and width persist (the parent owns the storage keys); the
 * free position is session-transient and re-anchors on pop-out.
 *
 * The browser itself (BoardBrowserPanel) is passed as children — it
 * exists exactly once; this component is only its Regular chrome.
 * In the Board layout the browser stays a free board panel and this
 * component is never mounted.
 */

import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeftRight,
  Globe,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";

export type BrowserDockSide = "left" | "right";

export const BROWSER_DOCK_MIN_WIDTH = 300;
export const BROWSER_DOCK_MAX_WIDTH = 720;
export const BROWSER_DOCK_DEFAULT_WIDTH = 420;

/** Clamp a dock width: absolute bounds plus a share of the window,
    so the workspace beside it always keeps a usable width. */
export function clampBrowserDockWidth(width: number): number {
  const windowCap =
    typeof window !== "undefined"
      ? Math.round(window.innerWidth * 0.62)
      : BROWSER_DOCK_MAX_WIDTH;
  const max = Math.max(BROWSER_DOCK_MIN_WIDTH, Math.min(BROWSER_DOCK_MAX_WIDTH, windowCap));
  return Math.max(BROWSER_DOCK_MIN_WIDTH, Math.min(max, Math.round(width)));
}

interface StudioBrowserSideDockProps {
  side: BrowserDockSide;
  onSideChange: (side: BrowserDockSide) => void;
  width: number;
  onWidthChange: (width: number) => void;
  free: boolean;
  onFreeChange: (free: boolean) => void;
  onClose: () => void;
  children: ReactNode;
}

const FLIP_DRAG_THRESHOLD = 140;

export default function StudioBrowserSideDock({
  side,
  onSideChange,
  width,
  onWidthChange,
  free,
  onFreeChange,
  onClose,
  children,
}: StudioBrowserSideDockProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  // Free-mode geometry: distance from the anchored side's edge and
  // from the top of the Studio body. Null until the first pop-out,
  // which anchors the panel beside its docked side.
  const [freeOffset, setFreeOffset] = useState<number | null>(null);
  const [freeTop, setFreeTop] = useState(12);

  const dragRef = useRef<{
    kind: "flip" | "move" | "resize";
    startX: number;
    startY: number;
    startSide: BrowserDockSide;
    startWidth: number;
    startOffset: number;
    startTop: number;
  } | null>(null);

  const containerSize = useCallback(() => {
    const parent = panelRef.current?.offsetParent as HTMLElement | null;
    return {
      width: parent?.clientWidth ?? window.innerWidth,
      height: parent?.clientHeight ?? window.innerHeight,
    };
  }, []);

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      dragRef.current = {
        kind: free ? "move" : "flip",
        startX: e.clientX,
        startY: e.clientY,
        startSide: side,
        startWidth: width,
        startOffset: freeOffset ?? 12,
        startTop: freeTop,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* jsdom / older engines: drag still works via move events */
      }
    },
    [free, side, width, freeOffset, freeTop],
  );

  const handleHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (drag.kind === "flip") {
        // Dragging the header across flips the dock to the other
        // side; the drag then re-anchors so dragging back flips it
        // home again.
        if (drag.startSide === "right" && dx < -FLIP_DRAG_THRESHOLD) {
          onSideChange("left");
          dragRef.current = { ...drag, startX: e.clientX, startSide: "left" };
        } else if (drag.startSide === "left" && dx > FLIP_DRAG_THRESHOLD) {
          onSideChange("right");
          dragRef.current = { ...drag, startX: e.clientX, startSide: "right" };
        }
        return;
      }
      // Free move — clamped fully inside the container: the panel
      // (and every control on it) can never be dragged off-screen.
      const { width: containerW, height: containerH } = containerSize();
      const rawOffset =
        drag.startSide === "right" ? drag.startOffset - dx : drag.startOffset + dx;
      const maxOffset = Math.max(0, containerW - width);
      setFreeOffset(Math.max(0, Math.min(maxOffset, rawOffset)));
      const maxTop = Math.max(0, containerH - 120);
      setFreeTop(Math.max(0, Math.min(maxTop, drag.startTop + dy)));
    },
    [containerSize, onSideChange, width],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragRef.current = {
        kind: "resize",
        startX: e.clientX,
        startY: e.clientY,
        startSide: side,
        startWidth: width,
        startOffset: freeOffset ?? 12,
        startTop: freeTop,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* see header drag */
      }
    },
    [side, width, freeOffset, freeTop],
  );

  const handleResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.kind !== "resize") return;
      const dx = e.clientX - drag.startX;
      const delta = drag.startSide === "right" ? -dx : dx;
      onWidthChange(clampBrowserDockWidth(drag.startWidth + delta));
    },
    [onWidthChange],
  );

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.key === "ArrowRight" ? 24 : -24;
        const delta = side === "right" ? -step : step;
        onWidthChange(clampBrowserDockWidth(width + delta));
      }
    },
    [side, width, onWidthChange],
  );

  const handleFlip = useCallback(() => {
    onSideChange(side === "right" ? "left" : "right");
  }, [side, onSideChange]);

  const handleToggleFree = useCallback(() => {
    if (!free) {
      // Pop out beside the side it was docked on.
      setFreeOffset(12);
      setFreeTop(12);
    }
    onFreeChange(!free);
  }, [free, onFreeChange]);

  const header = (
    <div
      data-testid="browser-dock-header"
      onPointerDown={handleHeaderPointerDown}
      onPointerMove={handleHeaderPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="flex shrink-0 cursor-grab items-center gap-1.5 border-b px-2 py-1.5 active:cursor-grabbing"
      style={{ borderColor: "var(--studio-border)", touchAction: "none" }}
      title="Drag to move — drag across to flip sides"
    >
      <Globe size={13} className="pointer-events-none shrink-0" style={{ color: "var(--color-accent)" }} />
      <span className="pointer-events-none text-[11px] font-bold" style={{ color: "var(--text-main)" }}>
        Browser
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={handleFlip}
        className="grid h-7 w-7 place-items-center rounded-lg transition hover:bg-black/5"
        style={{ color: "var(--text-muted)" }}
        aria-label={side === "right" ? "Flip browser to the left side" : "Flip browser to the right side"}
        title={side === "right" ? "Flip to the left side" : "Flip to the right side"}
        data-testid="browser-dock-flip"
      >
        <ArrowLeftRight size={13} className="pointer-events-none" />
      </button>
      <button
        type="button"
        onClick={handleToggleFree}
        className="grid h-7 w-7 place-items-center rounded-lg transition hover:bg-black/5"
        style={{ color: "var(--text-muted)" }}
        aria-label={free ? "Dock browser" : "Pop browser out"}
        title={free ? "Dock" : "Pop out"}
        data-testid="browser-dock-popout"
      >
        {free ? (
          <Minimize2 size={13} className="pointer-events-none" />
        ) : (
          <Maximize2 size={13} className="pointer-events-none" />
        )}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="grid h-7 w-7 place-items-center rounded-lg transition hover:bg-black/5"
        style={{ color: "var(--text-muted)" }}
        aria-label="Close browser"
        title="Close"
        data-testid="browser-dock-close"
      >
        <X size={13} className="pointer-events-none" />
      </button>
    </div>
  );

  // The resize divider sits on the edge facing the workspace.
  const resizeHandle = (
    <div
      data-testid="browser-dock-resize"
      data-resize-grip="true"
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize browser dock"
      tabIndex={0}
      onKeyDown={handleResizeKeyDown}
      onPointerDown={handleResizePointerDown}
      onPointerMove={handleResizePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="group absolute bottom-0 top-0 z-10 flex w-1.5 cursor-col-resize items-center justify-center transition hover:bg-black/5"
      style={{
        touchAction: "none",
        ...(side === "right" ? { left: 0 } : { right: 0 }),
      }}
    />
  );

  if (free) {
    return (
      <section
        ref={panelRef}
        data-testid="studio-browser-side-dock"
        data-side={side}
        data-mode="free"
        aria-label="Browser"
        className="absolute z-[60] flex flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
          width,
          top: freeTop,
          bottom: 12,
          ...(side === "right"
            ? { right: freeOffset ?? 12 }
            : { left: freeOffset ?? 12 }),
        }}
      >
        {resizeHandle}
        {header}
        <div className="min-h-0 flex-1">{children}</div>
      </section>
    );
  }

  return (
    <aside
      ref={panelRef}
      data-testid="studio-browser-side-dock"
      data-side={side}
      data-mode="docked"
      aria-label="Browser"
      className="relative flex h-full shrink-0 flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--studio-surface)",
        width,
        borderLeft: side === "right" ? "1px solid var(--studio-border)" : undefined,
        borderRight: side === "left" ? "1px solid var(--studio-border)" : undefined,
      }}
    >
      {resizeHandle}
      {header}
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  );
}
