"use client";

/**
 * BoardPanel — the floating window chrome for one board panel (plan §2 B1).
 *
 * Drag by the header (pointer events), resize from ANY edge or corner —
 * including the bottom edge to any height (board-only rebuild rule: no
 * locked heights) — maximize/restore, minimize (to the board tray),
 * close, and click-to-front z-order. The component is controlled:
 * geometry lives in useBoardLayoutStore, this only renders it and
 * reports gestures back.
 *
 * Styling binds to the ThemeContext skin tokens (the Discover pattern)
 * so light and dark presentations both come from the active skin — no
 * hard-coded surface colors.
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  BOARD_PANEL_STATUS_COLORS,
  type BoardPanelStatus,
} from "../../stores/useBoardPanelStatusStore";
import {
  BOARD_ACCENT_VIOLET,
  BOARD_MIN_PANEL_HEIGHT,
  BOARD_MIN_PANEL_WIDTH,
  type BoardPanelId,
  type BoardRect,
} from "./board-types";

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface DragSession {
  kind: "move" | "resize";
  edge: ResizeEdge | null;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRect: BoardRect;
}

/** Resize math for one edge/corner drag: the dragged edge follows the
 *  pointer, the opposite edge stays fixed, sizes floor at the panel
 *  minimums. Pure so the gesture handler stays a thin shell. */
export function resizedRect(start: BoardRect, edge: ResizeEdge, dx: number, dy: number): BoardRect {
  let { x, y, width, height } = start;
  if (edge.includes("e")) width = Math.max(BOARD_MIN_PANEL_WIDTH, start.width + dx);
  if (edge.includes("s")) height = Math.max(BOARD_MIN_PANEL_HEIGHT, start.height + dy);
  if (edge.includes("w")) {
    width = Math.max(BOARD_MIN_PANEL_WIDTH, start.width - dx);
    x = start.x + (start.width - width);
  }
  if (edge.includes("n")) {
    height = Math.max(BOARD_MIN_PANEL_HEIGHT, start.height - dy);
    y = Math.max(0, start.y + (start.height - height));
  }
  return { x, y, width, height };
}

/** One resize handle (edge or corner strip). Its pointer handler is a
 *  named function in this child's body: an inline arrow inside the
 *  parent's render-time .map() trips react-hooks/refs, because the lint
 *  rule cannot prove the closure only runs on pointer-down, while a
 *  named handler in a component body is recognized event-handler scope.
 *  Behavior is unchanged — the grab is forwarded with the handle's edge. */
function ResizeHandle({
  edge,
  className,
  testId,
  onGrab,
}: {
  edge: ResizeEdge;
  className: string;
  testId: string;
  onGrab: (edge: ResizeEdge, event: ReactPointerEvent) => void;
}) {
  const handlePointerDown = (event: ReactPointerEvent) => {
    onGrab(edge, event);
  };
  return (
    <div
      data-testid={testId}
      data-resize-edge={edge}
      aria-hidden
      className={`${className} touch-none`}
      onPointerDown={handlePointerDown}
    />
  );
}

export interface BoardPanelProps {
  id: BoardPanelId;
  title: string;
  rect: BoardRect;
  zIndex: number;
  maximized: boolean;
  /** Board viewport scale — pointer deltas are divided by it so a drag
   *  tracks the cursor 1:1 in board coordinates while zoomed out. */
  scale?: number;
  /** Phone layout (Studio Finish Spec): the panel renders in normal
   *  flow, full width, at a touch height — no absolute geometry, no
   *  drag, no resize handles. The board stacks panels vertically and
   *  the user scrolls between them. */
  stacked?: boolean;
  /** Panel icon for the header (Kimi wiring item 2): the same glyph the
   *  toolbar summons this panel with, so headers and toolbar read as
   *  one system. */
  icon?: ReactNode;
  /** Live status published by the panel's own real system (preview
   *  stage, terminal connection, checks result, deploy state) — shown
   *  as a dot in the header. Null/absent renders no dot: an unknown
   *  state is never dressed up as ok. */
  status?: BoardPanelStatus | null;
  /** This panel is the frontmost on the board: it carries the emphasis
   *  ring + deeper shadow (Kimi wiring item 2, from PanelFrame). */
  front?: boolean;
  onRectChange: (id: BoardPanelId, rect: BoardRect) => void;
  onBringToFront: (id: BoardPanelId) => void;
  onMinimize: (id: BoardPanelId) => void;
  onToggleMaximize: (id: BoardPanelId) => void;
  onClose: (id: BoardPanelId) => void;
  children?: ReactNode;
}

export default function BoardPanel({
  id,
  title,
  rect,
  zIndex,
  maximized,
  scale = 1,
  stacked = false,
  icon,
  status,
  front = false,
  onRectChange,
  onBringToFront,
  onMinimize,
  onToggleMaximize,
  onClose,
  children,
}: BoardPanelProps) {
  const { tokens } = useTheme();
  const sessionRef = useRef<DragSession | null>(null);
  // Spring settle (Kimi wiring item 2): a release-only flourish — when a
  // drag/resize ends somewhere new, the panel plays one short settle
  // keyframe. The drag engine above is untouched: geometry still comes
  // from the store on every pointermove; this only animates a transform
  // on the finished frame, and reduced-motion users never see it (the
  // keyframe class is gated in globals.css).
  const rectRef = useRef(rect);
  // Mirror the latest committed rect into the ref from an effect (the
  // drag session's onEnd reads it). Writing refs during render is
  // banned by react-hooks/refs; the effect keeps it current enough —
  // onEnd only asks "did the rect change at all", and every committed
  // move updates it.
  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);
  const [settling, setSettling] = useState(false);
  const settleTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const beginSession = (
    kind: DragSession["kind"],
    event: ReactPointerEvent,
    edge: ResizeEdge | null = null,
  ) => {
    if (maximized || stacked) return;
    // Pointer capture is load-bearing, not decoration (drag-sticking
    // defect, Larry 2026-11-14): without it, a drag that crosses the
    // Preview panel's cross-origin iframe delivers pointermove to the
    // iframe's document instead of this one — the panel freezes
    // mid-drag ("stuck"), and a pointerup inside the iframe never
    // reaches the window listener, so the session leaks and the panel
    // later jumps. Capturing retargets every event for this pointer to
    // the drag handle for the whole gesture, so the window listeners
    // below keep firing. Same pattern as StudioDock / ImageStudio.
    const captureTarget = event.currentTarget as HTMLElement;
    if (typeof captureTarget.setPointerCapture === "function") {
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        // Non-active pointer / jsdom — capture is an enhancement; the
        // window listeners still cover same-document drags.
      }
    }
    sessionRef.current = {
      kind,
      edge,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect,
    };
    const onMove = (move: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || move.pointerId !== session.pointerId) return;
      const dx = (move.clientX - session.startClientX) / (scale || 1);
      const dy = (move.clientY - session.startClientY) / (scale || 1);
      if (session.kind === "move") {
        onRectChange(id, {
          ...session.startRect,
          x: session.startRect.x + dx,
          y: Math.max(0, session.startRect.y + dy),
        });
      } else if (session.edge) {
        onRectChange(id, resizedRect(session.startRect, session.edge, dx, dy));
      }
    };
    const onEnd = (up: PointerEvent) => {
      const ended = sessionRef.current;
      if (!ended || up.pointerId !== ended.pointerId) return;
      sessionRef.current = null;
      // Settle only when the gesture actually moved the panel — a plain
      // click-to-front must not bounce the panel.
      const endRect = rectRef.current;
      if (
        endRect.x !== ended.startRect.x ||
        endRect.y !== ended.startRect.y ||
        endRect.width !== ended.startRect.width ||
        endRect.height !== ended.startRect.height
      ) {
        setSettling(true);
        if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = window.setTimeout(() => setSettling(false), 260);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (typeof captureTarget.hasPointerCapture === "function") {
        try {
          if (captureTarget.hasPointerCapture(up.pointerId)) {
            captureTarget.releasePointerCapture(up.pointerId);
          }
        } catch {
          // Capture already gone (browser releases it on pointerup).
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    // An interrupted gesture (touch scroll takeover, OS gesture) fires
    // pointercancel instead of pointerup — without this the session
    // would leak and the next plain pointermove would drag the panel.
    window.addEventListener("pointercancel", onEnd);
  };

  const handleResizeGrab = (edge: ResizeEdge, event: ReactPointerEvent) => {
    beginSession("resize", event, edge);
  };

  // Touch targets are at least 44×44 on phone-sized layouts (Finish
  // Spec): the header grows to 44px and its window buttons fill it.
  // Desktop keeps the compact 36px header / 24px buttons.
  const headerButton =
    "flex h-11 w-11 items-center justify-center rounded-md transition-colors hover:bg-black/5 md:h-6 md:w-6";

  return (
    <section
      data-testid={`board-panel-${id}`}
      data-panel-id={id}
      aria-label={`${title} panel`}
      className={
        (stacked
          ? "relative flex w-full shrink-0 flex-col overflow-hidden rounded-xl border shadow-lg"
          : "absolute flex flex-col overflow-hidden rounded-xl border shadow-lg") +
        (settling ? " board-panel-settling" : "")
      }
      style={
        stacked
          ? {
              height: Math.min(Math.max(rect.height, 340), 620),
              zIndex,
              backgroundColor: tokens.surface,
              borderColor: front ? BOARD_ACCENT_VIOLET : tokens.border,
              color: tokens.text,
            }
          : {
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              zIndex,
              backgroundColor: tokens.surface,
              borderColor: front ? BOARD_ACCENT_VIOLET : tokens.border,
              boxShadow: front
                ? `0 24px 48px rgba(0, 0, 0, 0.45), 0 0 0 1px ${BOARD_ACCENT_VIOLET}`
                : undefined,
              color: tokens.text,
            }
      }
      onPointerDown={() => onBringToFront(id)}
    >
      <header
        data-testid={`board-panel-header-${id}`}
        className="flex h-11 shrink-0 cursor-grab touch-none items-center gap-1 border-b px-2.5 active:cursor-grabbing md:h-9"
        style={{ borderColor: tokens.border }}
        onPointerDown={(event) => beginSession("move", event)}
        onDoubleClick={() => onToggleMaximize(id)}
      >
        {icon && (
          <span
            className="flex shrink-0 items-center"
            style={{ color: tokens.textMuted }}
            aria-hidden
          >
            {icon}
          </span>
        )}
        {status && (
          <span
            data-testid={`board-panel-status-${id}`}
            data-status-tone={status.tone}
            role="img"
            aria-label={status.label}
            title={status.label}
            className={`h-2 w-2 shrink-0 rounded-full ${status.pulse ? "animate-pulse" : ""}`}
            style={{ backgroundColor: BOARD_PANEL_STATUS_COLORS[status.tone] }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide">
          {title}
        </span>
        <button
          type="button"
          aria-label={`Minimize ${title}`}
          data-testid={`board-panel-minimize-${id}`}
          className={headerButton}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onMinimize(id)}
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`}
          data-testid={`board-panel-maximize-${id}`}
          className={headerButton}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onToggleMaximize(id)}
        >
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button
          type="button"
          aria-label={`Close ${title}`}
          data-testid={`board-panel-close-${id}`}
          className={headerButton}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onClose(id)}
        >
          <X size={13} />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      {!maximized && !stacked &&
        (
          [
            ["n", "absolute left-3 right-3 top-0 h-1.5 cursor-ns-resize"],
            ["s", "absolute bottom-0 left-3 right-3 h-1.5 cursor-ns-resize"],
            ["e", "absolute bottom-3 right-0 top-3 w-1.5 cursor-ew-resize"],
            ["w", "absolute bottom-3 left-0 top-3 w-1.5 cursor-ew-resize"],
            ["ne", "absolute right-0 top-0 h-3 w-3 cursor-nesw-resize"],
            ["nw", "absolute left-0 top-0 h-3 w-3 cursor-nwse-resize"],
            ["se", "absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"],
            ["sw", "absolute bottom-0 left-0 h-3 w-3 cursor-nesw-resize"],
          ] as [ResizeEdge, string][]
        ).map(([edge, className]) => (
          <ResizeHandle
            key={edge}
            edge={edge}
            className={className}
            testId={
              edge === "se" ? `board-panel-resize-${id}` : `board-panel-resize-${edge}-${id}`
            }
            onGrab={handleResizeGrab}
          />
        ))}
    </section>
  );
}
