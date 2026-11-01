"use client";

/**
 * PreviewDockHost — the positioning wrapper for the single preview
 * instance in EVERY placement, including `stage`. The host renders one
 * stable DOM tree and changes only computed style/visibility per mode,
 * so the StudioPreviewPanel subtree (and its iframe) is never reparented
 * or remounted across placement transitions. Conditional siblings before
 * the iframe would shift its child index and force a remount — every
 * structural node below is therefore rendered unconditionally and shown
 * or hidden purely via style/className.
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
 *   stage       — static fill of the preview stage slot (the panel's
 *                 original home); still the same DOM subtree.
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
      // Pointer capture retargets move/up to the grip so drags survive
      // crossing the embedded iframe (which would otherwise swallow events).
      e.currentTarget.setPointerCapture?.(e.pointerId);
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
    e.currentTarget.setPointerCapture?.(e.pointerId);
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

  // ── Single stable tree: every node renders unconditionally; placement
  // switches only styles so React never reparents the iframe. ────────────
  const isEdge = placement === "right" || placement === "left";
  const isSplit = placement === "split";
  const isEdgeLike = isEdge || isSplit;
  const isFloat = placement === "float";
  const isChat = placement === "chat";
  const isFullscreen = placement === "fullscreen";
  const isStage = placement === "stage";
  const showBar = isFloat || isChat || isFullscreen;

  const hostStyle: CSSProperties = isStage
    ? { position: "relative", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, flex: 1, overflow: "hidden" }
    : isFullscreen
      ? { position: "fixed", inset: 0, zIndex: 300, backgroundColor: "rgba(13,9,22,0.98)", padding: 12 }
      : isFloat
        ? {
            position: "fixed",
            left: floatRect.x,
            top: floatRect.y,
            width: floatRect.w,
            height: floatMinimized ? PREVIEW_FLOAT_MINIMIZED_H : floatRect.h,
            zIndex: 220,
            borderColor: "var(--studio-border)",
            backgroundColor: "var(--studio-card)",
          }
        : isChat
          ? (() => {
              const base = chatRect ?? { left: 64, top: 96, width: Math.min(480, viewport.w - 96) };
              return {
                position: "fixed",
                left: base.left,
                top: base.top,
                width: base.width,
                height: chatExpanded ? PREVIEW_CHAT_CARD_EXPANDED_H : PREVIEW_CHAT_CARD_H,
                zIndex: 220,
                borderColor: "var(--studio-border)",
                backgroundColor: "var(--studio-card)",
              } as CSSProperties;
            })()
          : {
              position: "absolute",
              top: 0,
              bottom: 0,
              [isSplit ? "right" : placement === "right" ? "right" : "left"]: 0,
              width: isSplit ? Math.round(viewport.w * splitFraction) : dockWidth,
              zIndex: 10,
            };

  const hostClass = isStage
    ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    : isFullscreen
      ? "flex min-h-0 flex-col"
      : isFloat || isChat
        ? "glass-shell flex flex-col overflow-hidden rounded-xl border shadow-2xl"
        : "flex min-h-0 flex-col border-l";

  return (
    <div
      className={hostClass}
      style={{ ...hostStyle, borderColor: "var(--studio-border)" }}
      data-testid="preview-dock-host"
      data-placement={placement}
      data-minimized={isFloat && floatMinimized ? "true" : "false"}
      data-expanded={isChat && chatExpanded ? "true" : "false"}
    >
      {/* ── Chrome bar — index 0, always rendered; display:none in modes
          that use the panel's own header chrome. Its buttons differ per
          mode but live inside this stable wrapper, so the body/iframe
          subtree (index 1) never shifts position. ── */}
      <div
        className="shrink-0 items-center justify-between gap-1 border-b px-2 py-1"
        style={{
          borderColor: "var(--studio-border)",
          touchAction: isFloat ? "none" : undefined,
          display: showBar ? "flex" : "none",
          justifyContent: isFullscreen ? "flex-end" : "space-between",
          cursor: isFloat ? "move" : undefined,
          userSelect: isFloat ? "none" : undefined,
        }}
        onPointerDown={isFloat ? onGripPointerDown("move") : undefined}
        role={isFloat ? "toolbar" : undefined}
        aria-label={isFloat ? "Move preview window" : undefined}
        data-testid={isFloat ? "preview-float-grip" : isChat ? "preview-chat-card-bar" : "preview-fullscreen-bar"}
      >
        <span
          className="truncate text-[10px] font-bold"
          style={{ color: "var(--text-muted)", display: isFullscreen ? "none" : undefined }}
        >
          Website preview
        </span>
        <div className="flex items-center gap-0.5" onPointerDown={isFloat ? (e) => e.stopPropagation() : undefined}>
          {chrome}
          {isChat ? (
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
          ) : null}
          {isFloat ? (
            <>
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
            </>
          ) : null}
        </div>
      </div>

      {/* ── Body — index 1, always rendered. Keep children mounted while
          float-minimized — unmounting the iframe subtree would reload the
          preview on restore. ── */}
      <div
        className={isFloat && floatMinimized ? "hidden" : "flex min-h-0 flex-1 flex-col"}
        data-testid="preview-float-body"
      >
        {children}
      </div>

      {/* ── Edge resize grip — index 2, style-only toggle. Grip sits on
          the inward edge: left for right-dock/split, right for left-dock. ── */}
      <div
        className="absolute bottom-0 top-0 z-10 w-1.5 cursor-col-resize hover:bg-white/10"
        style={{
          touchAction: "none",
          display: isEdgeLike ? undefined : "none",
          ...(isEdgeLike ? { [isSplit || placement === "right" ? "left" : "right"]: -3 } : {}),
        }}
        onPointerDown={isEdgeLike ? onDockEdgeDrag : undefined}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview panel"
        data-testid="preview-dock-resize"
      />

      {/* ── Float corner resize grip — index 3, style-only toggle. Inset
          8px: the host's 28px rounded corner is clipped by overflow:hidden,
          and Chromium hit-tests against the clipped shape — a grip flush in
          the corner is unreachable. ── */}
      <div
        className="absolute bottom-2 right-2 h-4 w-4 cursor-nwse-resize"
        style={{ touchAction: "none", display: isFloat && !floatMinimized ? undefined : "none" }}
        onPointerDown={isFloat && !floatMinimized ? onGripPointerDown("resize") : undefined}
        role="separator"
        aria-label="Resize preview window"
        data-testid="preview-float-resize"
      />
    </div>
  );
}
