"use client";

/**
 * BoardPanel — the floating window chrome for one board panel (plan §2 B1).
 *
 * Drag by the header (pointer events), resize from the bottom-right
 * corner, maximize/restore, minimize (to the board tray), close, and
 * click-to-front z-order. The component is controlled: geometry lives in
 * useBoardLayoutStore, this only renders it and reports gestures back.
 *
 * Styling follows the applied shell theme tokens (all-light under the
 * standard look — no hard-coded dark surfaces, per the chrome rule).
 */

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { BoardPanelId, BoardRect } from "./board-types";

interface DragSession {
  kind: "move" | "resize";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRect: BoardRect;
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
  onRectChange,
  onBringToFront,
  onMinimize,
  onToggleMaximize,
  onClose,
  children,
}: BoardPanelProps) {
  const { tokens } = useTheme();
  const sessionRef = useRef<DragSession | null>(null);

  const beginSession = (kind: DragSession["kind"]) => (event: ReactPointerEvent) => {
    if (maximized) return;
    sessionRef.current = {
      kind,
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
      } else {
        onRectChange(id, {
          ...session.startRect,
          width: session.startRect.width + dx,
          height: session.startRect.height + dy,
        });
      }
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== sessionRef.current?.pointerId) return;
      sessionRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const headerButton =
    "flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5";

  return (
    <section
      data-testid={`board-panel-${id}`}
      data-panel-id={id}
      aria-label={`${title} panel`}
      className="absolute flex flex-col overflow-hidden rounded-xl border shadow-lg"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex,
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
        color: tokens.text,
      }}
      onPointerDown={() => onBringToFront(id)}
    >
      <header
        data-testid={`board-panel-header-${id}`}
        className="flex h-9 shrink-0 cursor-grab touch-none items-center gap-1 border-b px-2.5 active:cursor-grabbing"
        style={{ borderColor: tokens.border }}
        onPointerDown={beginSession("move")}
        onDoubleClick={() => onToggleMaximize(id)}
      >
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
      {!maximized && (
        <div
          data-testid={`board-panel-resize-${id}`}
          aria-hidden
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
          onPointerDown={beginSession("resize")}
        />
      )}
    </section>
  );
}
