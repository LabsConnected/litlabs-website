"use client";

/**
 * SelectionOverlay — the on-canvas manipulation affordance for a selected
 * preview element. Rendered absolutely over the preview iframe container.
 *
 *   - Bounding box + label chip (`{componentName ?? label} · <{tag}>`)
 *     + dimensions chip, positioned from same-origin measured nodes or
 *     forward-compatible bridge x/y (rect.x/rect.y when the inspector
 *     bridge starts sending them).
 *   - 4 corner resize handles and a move grip (move grip only when the
 *     element's computed position is absolute/fixed/relative — no dead
 *     handles).
 *   - Width/height and top/left patches commit ONLY on drag-release,
 *     through the real useElementEdits pipeline, with saved/error
 *     feedback. No fake success: handles render only while the edit
 *     pipeline is ready, and a failed commit surfaces the reason.
 *   - Ask LiTT button dispatches `studio:ask-litt` with the selection.
 *
 * Recomputes on selection change, window resize, container resize, and
 * (same-origin) preview scroll. If the box cannot be measured honestly,
 * nothing renders.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Move, Sparkles } from "lucide-react";
import type { PreviewSelection } from "../StudioPreviewPanel";
import { useElementEdits } from "../../hooks/useElementEdits";
import type { ElementEdits } from "./ElementInspectorPanel";

export interface OverlaySelection extends Omit<PreviewSelection, "rect"> {
  rect?: { width: number; height: number; x?: number; y?: number };
  componentName?: string;
}

interface Box { x: number; y: number; w: number; h: number; }

type Corner = "nw" | "ne" | "sw" | "se";

interface DragState {
  kind: "move" | "resize";
  corner?: Corner;
  startClientX: number;
  startClientY: number;
  orig: Box;
}

const MIN_SIZE = 12;

export default function SelectionOverlay({
  selection,
  projectId,
  anchorNode,
  iframeRef,
  containerRef,
  contentKey,
  route,
  onAskAboutSelection,
  edits: injectedEdits,
}: {
  selection: OverlaySelection | null;
  projectId: string | null;
  /** Same-origin measured node. Null for cross-origin previews. */
  anchorNode: HTMLElement | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Positioned wrapper the overlay renders inside. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Bump to force re-measure (e.g. iframe reload). */
  contentKey?: number | string;
  route?: string | null;
  onAskAboutSelection?: () => void;
  /** Injected edit pipeline (harness/visual verification). Defaults to
      the real useElementEdits(projectId). */
  edits?: ElementEdits;
}) {
  const realEdits = useElementEdits(projectId);
  const edits = injectedEdits ?? realEdits;
  const [box, setBox] = useState<Box | null>(null);
  const [contentSize, setContentSize] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const selectionKey = selection ? `${selection.selector}|${selection.tagName}` : null;

  // Resolve the element into the real edit pipeline (mirrors the inspector
  // panel's effect; a second instance resolving the same element is fine).
  // An injected harness pipeline is pre-resolved — don't re-resolve.
  useEffect(() => {
    if (!selection || injectedEdits) return;
    void edits.resolve(
      {
        selector: selection.selector,
        tagName: selection.tagName,
        label: selection.label,
        attrs: selection.attrs,
        text: selection.text,
        path: selection.path,
      },
      route ?? null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, projectId, route, injectedEdits]);

  const flash = useCallback((kind: "saved" | "error", text: string) => {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    setFeedback({ kind, text });
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 2200);
  }, []);

  const measure = useCallback(() => {
    const wrap = containerRef.current;
    if (!wrap || !selection) {
      setBox(null);
      return;
    }
    // The overlay covers the full scrollable content so boxes stay
    // positioned when the wrapper scrolls.
    setContentSize({
      w: Math.max(wrap.clientWidth, wrap.scrollWidth),
      h: Math.max(wrap.clientHeight, wrap.scrollHeight),
    });
    const wrapRect = wrap.getBoundingClientRect();
    const sl = wrap.scrollLeft;
    const st = wrap.scrollTop;
    if (anchorNode && anchorNode.isConnected) {
      const r = anchorNode.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        setBox(null);
        return;
      }
      setBox({
        x: r.left - wrapRect.left + sl,
        y: r.top - wrapRect.top + st,
        w: r.width,
        h: r.height,
      });
      return;
    }
    // Forward-compatible bridge x/y (cross-origin).
    const rect = selection.rect;
    if (rect && typeof rect.x === "number" && typeof rect.y === "number" && rect.width > 0 && rect.height > 0) {
      const fr = iframeRef.current?.getBoundingClientRect();
      const ox = fr ? fr.left - wrapRect.left + sl : 0;
      const oy = fr ? fr.top - wrapRect.top + st : 0;
      setBox({ x: ox + rect.x, y: oy + rect.y, w: rect.width, h: rect.height });
      return;
    }
    // No honest position — don't render a box.
    setBox(null);
  }, [selection, anchorNode, containerRef, iframeRef]);

  useLayoutEffect(() => {
    measure();
  }, [measure, contentKey]);

  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    // ResizeObserver is unavailable in some environments (jsdom) — the
    // window resize listener above is the fallback.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (ro && wrap) ro.observe(wrap);
    // Same-origin preview scroll moves the node under the overlay.
    let scrollCleanup: (() => void) | null = null;
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        doc.addEventListener("scroll", onResize, true);
        scrollCleanup = () => doc.removeEventListener("scroll", onResize, true);
      }
    } catch {
      // Cross-origin: cannot observe inside the frame.
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      scrollCleanup?.();
    };
  }, [measure, containerRef, iframeRef, contentKey]);

  const commitPatch = useCallback(async (patch: { styles: Record<string, string> }) => {
    const ok = await edits.applyPatch(patch);
    if (ok) flash("saved", "Saved");
    else flash("error", edits.statusReason || "Save failed");
    // Re-measure after the patch lands so the box matches reality.
    window.setTimeout(() => measure(), 60);
  }, [edits, flash, measure]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag || !box) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    const o = drag.orig;
    if (drag.kind === "move") {
      setBox({ ...o, x: o.x + dx, y: o.y + dy });
      return;
    }
    const corner = drag.corner ?? "se";
    let { x, y, w, h } = o;
    if (corner.includes("e")) w = Math.max(MIN_SIZE, o.w + dx);
    if (corner.includes("s")) h = Math.max(MIN_SIZE, o.h + dy);
    if (corner.includes("w")) {
      w = Math.max(MIN_SIZE, o.w - dx);
      x = o.x + (o.w - w);
    }
    if (corner.includes("n")) {
      h = Math.max(MIN_SIZE, o.h - dy);
      y = o.y + (o.h - h);
    }
    setBox({ x, y, w, h });
  }, [drag, box]);

  const endDrag = useCallback(() => {
    if (!drag || !box || !selection) {
      setDrag(null);
      return;
    }
    const o = drag.orig;
    setDrag(null);
    if (drag.kind === "move") {
      const dx = box.x - o.x;
      const dy = box.y - o.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      if (anchorNode && anchorNode.isConnected) {
        // Commit against the element's offsetParent so top/left resolve
        // exactly where the box was dropped.
        const newLeft = Math.round(anchorNode.offsetLeft + dx);
        const newTop = Math.round(anchorNode.offsetTop + dy);
        void commitPatch({ styles: { left: `${newLeft}px`, top: `${newTop}px` } });
      } else if (selection.rect && typeof selection.rect.x === "number" && typeof selection.rect.y === "number") {
        const newLeft = Math.round(selection.rect.x + dx);
        const newTop = Math.round(selection.rect.y + dy);
        void commitPatch({ styles: { left: `${newLeft}px`, top: `${newTop}px` } });
      }
      return;
    }
    // Resize — commit border-box px, correcting for content-box so the
    // rendered size matches the dragged box.
    let w = Math.round(box.w);
    let h = Math.round(box.h);
    if (anchorNode && anchorNode.isConnected) {
      try {
        const cs = getComputedStyle(anchorNode);
        if (cs.boxSizing === "content-box") {
          const px = (v: string) => parseFloat(v) || 0;
          w = Math.max(MIN_SIZE, Math.round(box.w - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)));
          h = Math.max(MIN_SIZE, Math.round(box.h - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth)));
        }
      } catch {
        // Fall through with measured values.
      }
    }
    void commitPatch({ styles: { width: `${w}px`, height: `${h}px` } });
  }, [drag, box, selection, anchorNode, commitPatch]);

  if (!selection || !box) return null;

  const computedPosition = (() => {
    if (anchorNode && anchorNode.isConnected) {
      try {
        return getComputedStyle(anchorNode).position;
      } catch {
        return "";
      }
    }
    return selection.styles?.["position"] ?? "";
  })();
  const canMove = computedPosition === "absolute" || computedPosition === "fixed" || computedPosition === "relative";
  const editable = edits.status === "ready" || edits.status === "applying";
  const busy = edits.status === "applying";
  const label = selection.componentName ?? selection.label;
  const tag = selection.tagName;

  const askAboutSelection = () => {
    if (onAskAboutSelection) {
      onAskAboutSelection();
      return;
    }
    window.dispatchEvent(new CustomEvent("studio:ask-litt", {
      detail: {
        selection: {
          kind: "preview-element",
          label: selection.label,
          selector: selection.selector,
          tagName: selection.tagName,
          projectId,
          timestamp: Date.now(),
        },
      },
    }));
  };

  const corners: { id: Corner; cursor: string; style: React.CSSProperties }[] = [
    { id: "nw", cursor: "nwse-resize", style: { left: -5, top: -5 } },
    { id: "ne", cursor: "nesw-resize", style: { right: -5, top: -5 } },
    { id: "sw", cursor: "nesw-resize", style: { left: -5, bottom: -5 } },
    { id: "se", cursor: "nwse-resize", style: { right: -5, bottom: -5 } },
  ];

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-20"
      style={contentSize ? { width: contentSize.w, height: contentSize.h } : { width: "100%", height: "100%" }}
      data-testid="selection-overlay"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={() => setDrag(null)}
    >
      {/* Bounding box */}
      <div
        className="absolute rounded-[2px] border-2"
        style={{
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          borderColor: "var(--litt-primary, #9b4dff)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.45), 0 0 18px rgba(155,77,255,0.28)",
        }}
      >
        {/* Label chip */}
        <div
          className="pointer-events-auto absolute -top-7 left-0 flex max-w-[280px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold"
          style={{ backgroundColor: "var(--litt-primary, #9b4dff)", color: "#fff" }}
          data-testid="selection-overlay-label"
        >
          <span className="max-w-[180px] truncate">{label}</span>
          {tag && <span className="font-mono opacity-80">&lt;{tag}&gt;</span>}
        </div>

        {/* Dimensions chip */}
        <div
          className="pointer-events-auto absolute -bottom-6 right-0 rounded px-1.5 py-0.5 font-mono text-[9px]"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", color: "var(--text-secondary)" }}
          data-testid="selection-overlay-dims"
        >
          {Math.round(box.w)}×{Math.round(box.h)}
        </div>

        {/* Ask LiTT */}
        <button
          type="button"
          onClick={askAboutSelection}
          className="pointer-events-auto absolute -top-7 right-0 flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold"
          style={{
            borderColor: "rgba(190,145,255,0.4)",
            backgroundColor: "rgba(13,9,22,0.92)",
            color: "var(--accent-color, #9b4dff)",
          }}
          data-testid="selection-overlay-ask"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
          Ask LiTT
        </button>

        {/* Move grip — only for positioned elements */}
        {canMove && editable && (
          <button
            type="button"
            aria-label="Move element"
            title={computedPosition === "relative" ? "Drag to move (relative offset)" : "Drag to move"}
            className="pointer-events-auto absolute left-1/2 top-1/2 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-move place-items-center rounded-full border"
            style={{
              borderColor: "var(--litt-primary, #9b4dff)",
              backgroundColor: "rgba(13,9,22,0.92)",
              color: "var(--litt-primary, #9b4dff)",
              touchAction: "none",
            }}
            data-testid="selection-overlay-move"
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              setDrag({ kind: "move", startClientX: e.clientX, startClientY: e.clientY, orig: box });
            }}
          >
            <Move size={11} className="pointer-events-none" />
          </button>
        )}

        {/* Resize handles — only while the edit pipeline is ready */}
        {editable && corners.map((c) => (
          <div
            key={c.id}
            role="slider"
            aria-label={`Resize ${c.id}`}
            className="pointer-events-auto absolute h-2.5 w-2.5 rounded-[3px] border"
            style={{
              ...c.style,
              cursor: c.cursor,
              borderColor: "var(--litt-primary, #9b4dff)",
              backgroundColor: "#fff",
              touchAction: "none",
            }}
            data-testid={`selection-overlay-resize-${c.id}`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              setDrag({ kind: "resize", corner: c.id, startClientX: e.clientX, startClientY: e.clientY, orig: box });
            }}
          />
        ))}
      </div>

      {/* Saved / error feedback */}
      {feedback && (
        <div
          className="pointer-events-auto absolute rounded-md border px-2 py-1 text-[10px] font-bold"
          style={{
            left: box.x,
            top: box.y + box.h + 8,
            borderColor: feedback.kind === "saved" ? "rgba(125,216,125,0.4)" : "rgba(239,68,68,0.4)",
            backgroundColor: "rgba(13,9,22,0.94)",
            color: feedback.kind === "saved" ? "#7dd87d" : "#fca5a5",
          }}
          role="status"
          data-testid="selection-overlay-feedback"
        >
          {busy && feedback.kind === "saved" ? "Saving…" : feedback.text}
        </div>
      )}

      {/* Pipeline unavailable — honest note, no dead handles */}
      {!editable && edits.status !== "resolving" && (
        <div
          className="pointer-events-auto absolute rounded px-1.5 py-0.5 text-[9px]"
          style={{
            left: box.x,
            top: box.y + box.h + 4,
            backgroundColor: "rgba(0,0,0,0.75)",
            color: "var(--text-muted)",
          }}
          data-testid="selection-overlay-readonly"
        >
          {edits.statusReason ?? "Read-only selection"}
        </div>
      )}
    </div>
  );
}
