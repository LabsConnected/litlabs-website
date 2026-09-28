"use client";

/**
 * MobileDragSheet — a draggable bottom sheet for the responsive Studio
 * phone tier.
 *
 * Used for the inspector (draggable over Preview/Canvas) and other
 * phone-tier sheets. Drag the handle down to dismiss; the sheet snaps
 * back if released above the dismiss threshold. Backdrop tap and Escape
 * also close. Respects the visual-viewport bottom inset so the sheet
 * clears the software keyboard.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useVisualViewport } from "../../hooks/useVisualViewport";

export default function MobileDragSheet({
  open,
  onClose,
  title,
  children,
  testId,
  initialHeight = "62dvh",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
  /** CSS height for the resting state. */
  initialHeight?: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; deltaY: number; dragging: boolean }>({
    startY: 0,
    deltaY: 0,
    dragging: false,
  });
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const vv = useVisualViewport();

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Reset the drag offset whenever the sheet opens.
  useEffect(() => {
    if (open) setDragOffset(0);
  }, [open ]);

  if (!open) return null;

  const beginDrag = (clientY: number) => {
    dragState.current = { startY: clientY, deltaY: 0, dragging: true };
    setIsDragging(true);
  };
  const moveDrag = (clientY: number) => {
    if (!dragState.current.dragging) return;
    const deltaY = Math.max(0, clientY - dragState.current.startY);
    dragState.current.deltaY = deltaY;
    setDragOffset(deltaY);
  };
  const endDrag = () => {
    if (!dragState.current.dragging) return;
    const { deltaY } = dragState.current;
    dragState.current.dragging = false;
    setIsDragging(false);
    if (deltaY > 120) {
      onClose();
    } else {
      setDragOffset(0);
    }
  };

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10022] bg-black/55"
        onClick={onClose}
        aria-label={`Close ${title}`}
        tabIndex={-1}
        aria-hidden
      />
      <div
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-[10023] flex flex-col overflow-hidden rounded-t-2xl border-t"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId ?? "mobile-drag-sheet"}
        tabIndex={-1}
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border-strong)",
          height: initialHeight,
          maxHeight: "88dvh",
          bottom: vv.bottomInset > 0 ? `${vv.bottomInset}px` : undefined,
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: isDragging ? "none" : "transform 160ms ease-out",
        }}
      >
        {/* Drag handle — the whole header strip is the drag target. */}
        <div
          className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(e) => beginDrag(e.clientY)}
          onPointerMove={(e) => moveDrag(e.clientY)}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-testid="mobile-drag-sheet-handle"
          aria-label={`Drag to dismiss ${title}`}
        >
          <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-white/25" aria-hidden />
          <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
            <span
              style={{
                fontSize: 11,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "var(--text-secondary)",
              }}
            >
              {title}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="grid h-[44px] w-[44px] place-items-center rounded-md hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              // Don't start a drag when tapping the close button.
              onPointerDown={(e) => e.stopPropagation()}
            >
              <X size={18} className="pointer-events-none" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto studio-scroll">{children}</div>
      </div>
    </>
  );
}
