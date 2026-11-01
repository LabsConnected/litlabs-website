"use client";

/**
 * PreviewDockHost — the positioning wrapper for the single preview
 * instance in every non-`stage` placement. The host keeps a fixed DOM
 * position inside the stage render tree; only its computed rect changes
 * per mode, so the StudioPreviewPanel subtree (and its iframe) is never
 * reparented or remounted.
 *
 * Modes:
 *   right/left  — absolute strip along the stage edge, resizable via the
 *                 spacer + ResizeHandle rendered in flow next to it.
 *   split       — like `right`, width = splitFraction of the stage.
 *   float       — fixed draggable/resizable window (title-bar drag,
 *                 corner resize grip, minimize, restore, dock-back).
 *   chat        — fixed card tracking the `#studio-chat-preview-anchor`
 *                 rect inside the chat transcript (ResizeObserver +
 *                 scroll capture); expandable to a taller card.
 *   fullscreen  — fixed inset-0 overlay (same as the panel's legacy
 *                 `maximized`, now driven by placement).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Minus, PictureInPicture2, X } from "lucide-react";
import {
  PREVIEW_CHAT_CARD_EXPANDED_H,
  PREVIEW_CHAT_CARD_H,
  PREVIEW_FLOAT_MINIMIZED_H,
  PREVIEW_FLOAT_MIN_H,
  PREVIEW_FLOAT_MIN_W,
  type PreviewFloatRect,
  type PreviewPlacement,
} from "../../lib/preview-dock";

export const CHAT_ANCHOR_SELECTOR = "[data-preview-chat-anchor]";

interface PreviewDockHostProps {
  placement: PreviewPlacement;
  dockWidth: number;
  splitFraction: number;
  onDockWidthChange: (w: number) => void;
  onSplitFractionChange: (f: number) => void;
  floatRect: PreviewFloatRect;
  floatMinimized: boolean;
  chatExpanded: boolean;
  onFloatRectChange: (r: PreviewFloatRect) => void;
  onFloatMinimizedChange: (m: boolean) => void;
  onChatExpandedChange: (e: boolean) => void;
  onPlacementChange: (p: PreviewPlacement) => void;
  chrome?: ReactNode;
  children: ReactNode;
}

function useChatAnchorRect(): { left: number; top: number; width: number } | null {
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    let anchor: Element | null = null;
    const measure = () => {
      const el = anchor ?? document.querySelector(CHAT_ANCHOR_SELECTOR);
      if (!el) {
        if (anchor !== null) {
          anchor = null;
          setRect(null);
        }
        return;
      }
      anchor = el;
      const r = el.getBoundingClientRect();
      // Anchor present but collapsed/hidden (chat closed) → null so the
      // card falls back to a default position instead of a 0-width strip.
      if (r.width < 64) {
        setRect(null);
        return;
      }
      setRect((prev) =>
        prev && Math.abs(prev.left - r.left) < 0.5 && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.width - r.width) < 0.5
          ? prev
          : { left: r.left, top: r.top, width: r.width },
      );
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const attach = () => {
      const el = document.querySelector(CHAT_ANCHOR_SELECTOR);
      if (el && ro) ro.observe(el);
    };
    attach();
    const onScrollOrResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    // Bounded poll until the anchor mounts (chat may open after the
    // preview); scroll/resize listeners keep tracking it afterwards.
    let polls = 0;
    const t = window.setInterval(() => {
      polls += 1;
      if (!anchor) attach();
      measure();
      if (anchor || polls > 120) window.clearInterval(t);
    }, 500);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(t);
      ro?.disconnect();
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, []);
  return rect;
}

export default function PreviewDockHost({
  placement,
  dockWidth,
  splitFraction,
  onDockWidthChange,
  onSplitFractionChange,
  floatRect,
  floatMinimized,
  chatExpanded,
  onFloatRectChange,
  onFloatMinimizedChange,
  onChatExpandedChange,
  onPlacementChange,
  chrome,
  children,
}: PreviewDockHostProps) {
  const chatRect = useChatAnchorRect();
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; rect: PreviewFloatRect } | null>(null);

  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const onGripPointerDown = useCallback(
    (mode: "move" | "resize") => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragRef.current = { mode, startX: e.clientX, startY: e.clientY, rect: { ...floatRect } };
      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        if (d.mode === "move") {
          onFloatRectChange({ ...d.rect, x: d.rect.x + ev.clientX - d.startX, y: d.rect.y + ev.clientY - d.startY });
        } else {
          onFloatRectChange({
            ...d.rect,
            w: Math.max(PREVIEW_FLOAT_MIN_W, d.rect.w + ev.clientX - d.startX),
            h: Math.max(PREVIEW_FLOAT_MIN_H, d.rect.h + ev.clientY - d.startY),
          });
        }
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [floatRect, onFloatRectChange],
  );

  const onDockEdgeDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const startF = splitFraction;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (placement === "split") {
        onSplitFractionChange(startF - dx / Math.max(320, viewport.w));
      } else {
        onDockWidthChange(startW + (placement === "right" ? -dx : dx));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (placement === "right" || placement === "left") {
    const style: CSSProperties = {
      position: "absolute",
      top: 0,
      bottom: 0,
      [placement === "right" ? "right" : "left"]: 0,
      width: dockWidth,
      zIndex: 10,
    };
    return (
      <div className="flex min-h-0 flex-col border-l" style={{ ...style, borderColor: "var(--studio-border)" }} data-testid="preview-dock-host" data-placement={placement}>
        <div
          className="absolute bottom-0 top-0 z-10 w-1.5 cursor-col-resize hover:bg-white/10"
          style={{ [placement === "right" ? "left" : "right"]: -3, touchAction: "none" }}
          onPointerDown={onDockEdgeDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview panel"
          data-testid="preview-dock-resize"
        />
        {children}
      </div>
    );
  }

  if (placement === "split") {
    const w = Math.round(viewport.w * splitFraction);
    return (
      <div
        className="flex min-h-0 flex-col border-l"
        style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: w, zIndex: 10, borderColor: "var(--studio-border)" }}
        data-testid="preview-dock-host"
        data-placement="split"
      >
        <div
          className="absolute bottom-0 left-[-3px] top-0 z-10 w-1.5 cursor-col-resize hover:bg-white/10"
          style={{ touchAction: "none" }}
          onPointerDown={onDockEdgeDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview panel"
          data-testid="preview-dock-resize"
        />
        {children}
      </div>
    );
  }

  if (placement === "fullscreen") {
    return (
      <div
        className="flex min-h-0 flex-col p-3"
        style={{ position: "fixed", inset: 0, zIndex: 300, backgroundColor: "rgba(13,9,22,0.98)" }}
        data-testid="preview-dock-host"
        data-placement="fullscreen"
      >
        {chrome ? <div className="flex shrink-0 justify-end pb-1">{chrome}</div> : null}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    );
  }

  if (placement === "chat") {
    const base = chatRect ?? { left: 64, top: 96, width: Math.min(480, viewport.w - 96) };
    const h = chatExpanded ? PREVIEW_CHAT_CARD_EXPANDED_H : PREVIEW_CHAT_CARD_H;
    return (
      <div
        className="glass-shell flex flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ position: "fixed", left: base.left, top: base.top, width: base.width, height: h, zIndex: 220, borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}
        data-testid="preview-dock-host"
        data-placement="chat"
        data-expanded={chatExpanded ? "true" : "false"}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-1 border-b px-2 py-1"
          style={{ borderColor: "var(--studio-border)" }}
          data-testid="preview-chat-card-bar"
        >
          <span className="truncate text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>
            Website preview
          </span>
          <div className="flex items-center gap-0.5">
            {chrome}
            <button
              type="button"
              onClick={() => onChatExpandedChange(!chatExpanded)}
              className="grid min-h-9 min-w-9 place-items-center rounded-md hover:bg-white/10"
              aria-label={chatExpanded ? "Collapse preview card" : "Expand preview card"}
              title={chatExpanded ? "Collapse" : "Expand"}
              data-testid="preview-chat-expand"
            >
              <PictureInPicture2 size={12} className="pointer-events-none" style={{ color: "var(--text-muted)" }} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    );
  }

  // float
  const h = floatMinimized ? PREVIEW_FLOAT_MINIMIZED_H : floatRect.h;
  return (
    <div
      className="glass-shell flex flex-col overflow-hidden rounded-xl border shadow-2xl"
      style={{ position: "fixed", left: floatRect.x, top: floatRect.y, width: floatRect.w, height: h, zIndex: 220, borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}
      data-testid="preview-dock-host"
      data-placement="float"
      data-minimized={floatMinimized ? "true" : "false"}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center justify-between gap-1 border-b px-2 py-1"
        style={{ borderColor: "var(--studio-border)", touchAction: "none" }}
        onPointerDown={onGripPointerDown("move")}
        role="toolbar"
        aria-label="Move preview window"
        data-testid="preview-float-grip"
      >
        <span className="truncate text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>
          Website preview
        </span>
        <div className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          {chrome}
          <button
            type="button"
            onClick={() => onFloatMinimizedChange(!floatMinimized)}
            className="grid min-h-9 min-w-9 place-items-center rounded-md hover:bg-white/10"
            aria-label={floatMinimized ? "Restore preview window" : "Minimize preview window"}
            title={floatMinimized ? "Restore" : "Minimize"}
            data-testid="preview-float-minimize"
          >
            <Minus size={12} className="pointer-events-none" style={{ color: "var(--text-muted)" }} />
          </button>
          <button
            type="button"
            onClick={() => onPlacementChange("right")}
            className="grid min-h-9 min-w-9 place-items-center rounded-md hover:bg-white/10"
            aria-label="Dock preview right"
            title="Dock right"
            data-testid="preview-float-dock"
          >
            <X size={12} className="pointer-events-none" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>
      </div>
      {/* Keep children mounted while minimized — unmounting the iframe
          subtree would reload the preview on restore. */}
      <div
        className={floatMinimized ? "hidden" : "flex min-h-0 flex-1 flex-col"}
        data-testid="preview-float-body"
      >
        {children}
      </div>
      {!floatMinimized && (
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{ touchAction: "none" }}
          onPointerDown={onGripPointerDown("resize")}
          role="separator"
          aria-label="Resize preview window"
          data-testid="preview-float-resize"
        />
      )}
    </div>
  );
}
