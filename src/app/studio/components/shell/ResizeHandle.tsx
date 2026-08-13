"use client";

/**
 * ResizeHandle — visible, keyboard-accessible vertical resize grip.
 *
 * Renders a thin draggable bar between two panes. Supports:
 * - Mouse drag
 * - Touch drag
 * - Keyboard: ArrowLeft/ArrowRight to adjust by 8px, Shift+Arrow for 32px
 * - Double-click to reset
 * - Visual feedback on hover and active drag
 * - No text selection while dragging (handled by the hook)
 */

import { useCallback } from "react";

export interface ResizeHandleProps {
  /** Drag start handler from useResizableWidth */
  onDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Reset to default width */
  onReset: () => void;
  /** Whether a drag is active (for visual feedback) */
  isDragging?: boolean;
  /** Direction the handle grows toward */
  direction?: "left" | "right";
  /** Accessible label */
  ariaLabel?: string;
  /** Test ID */
  testId?: string;
}

export default function ResizeHandle({
  onDragStart,
  onReset,
  isDragging = false,
  direction = "right",
  ariaLabel = "Resize panel",
  testId,
}: ResizeHandleProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 32 : 8;
      // For "right" direction: ArrowLeft grows, ArrowRight shrinks
      // For "left" direction: ArrowRight grows, ArrowLeft shrinks
      // We dispatch a synthetic drag by calling onDragStart then
      // simulating move — but simpler: just emit a custom event
      // that the parent can listen for. However, the cleanest approach
      // is to let the keyboard adjust via a callback. Since the hook
      // manages width, we use a data attribute approach: the parent
      // passes onDragStart which sets up the drag. For keyboard, we
      // use a different approach — dispatch a CustomEvent.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const sign = direction === "left" ? 1 : -1;
        const delta = (e.key === "ArrowLeft" ? sign : -sign) * step;
        window.dispatchEvent(
          new CustomEvent("studio:resize-keyboard", { detail: { delta } }),
        );
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onReset();
      }
    },
    [direction, onReset],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid={testId}
      data-resize-handle={direction}
      data-dragging={isDragging}
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className="group relative z-20 flex h-full w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors"
      style={{
        backgroundColor: isDragging
          ? "rgba(139,92,246,0.4)"
          : "rgba(155,77,255,0.08)",
      }}
    >
      {/* Visible grip dots */}
      <div
        className="flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-60"
        style={{ pointerEvents: "none" }}
        aria-hidden
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-0.5 w-0.5 rounded-full"
            style={{ backgroundColor: "rgba(155,77,255,0.6)" }}
          />
        ))}
      </div>
      {/* Wider hit area for easier grabbing */}
      <div
        className="absolute inset-y-0 -left-1 -right-1"
        style={{ pointerEvents: "auto" }}
        aria-hidden
      />
    </div>
  );
}
