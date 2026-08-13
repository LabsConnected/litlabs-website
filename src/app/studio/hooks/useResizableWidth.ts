"use client";

/**
 * useResizableWidth — pixel-precise resizable pane hook.
 *
 * Gives exact pixel control with:
 * - localStorage persistence (per-user optional)
 * - min/max clamping
 * - double-click reset to default
 * - drag via mouse and touch
 * - no text selection while dragging
 * - SSR-safe (returns default until mounted)
 *
 * This is cleaner than react-resizable-panels v4 for panes that have
 * collapsed/closed states (LiTT 64px, ContextDrawer 0px) because that
 * library uses percentage-based string sizes that don't map to exact
 * pixel collapsed widths.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ResizableWidthOptions {
  /** Storage key — if provided, width is persisted to localStorage */
  storageKey?: string;
  /** Default width in pixels */
  defaultWidth: number;
  /** Minimum width in pixels */
  minWidth: number;
  /** Maximum width in pixels */
  maxWidth: number;
  /** Direction the pane grows — "left" means dragging right increases width */
  direction?: "left" | "right";
}

export interface ResizableWidthResult {
  /** Current width in pixels */
  width: number;
  /** Whether a drag is in progress */
  isDragging: boolean;
  /** Start a resize drag — attach to onMouseDown / onTouchStart on the handle */
  onDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Reset to default width */
  reset: () => void;
  /** Set width directly (clamped) */
  setWidth: (w: number) => void;
}

export function useResizableWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  direction = "right",
}: ResizableWidthOptions): ResizableWidthResult {
  const [width, setWidthState] = useState<number>(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const draggingRef = useRef(false);

  // Load persisted width on mount
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) {
          setWidthState(clamp(parsed, minWidth, maxWidth));
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist width changes (debounced via rAF)
  const persistRef = useRef<number | null>(null);
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    if (persistRef.current !== null) {
      cancelAnimationFrame(persistRef.current);
    }
    persistRef.current = requestAnimationFrame(() => {
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {
        // ignore
      }
    });
  }, [width, storageKey]);

  const clamp = (w: number, min: number, max: number) =>
    Math.min(max, Math.max(min, w));

  const setWidth = useCallback(
    (w: number) => setWidthState(clamp(w, minWidth, maxWidth)),
    [minWidth, maxWidth],
  );

  const reset = useCallback(() => {
    setWidthState(defaultWidth);
  }, [defaultWidth]);

  // Global mouse/touch move + up listeners during drag
  useEffect(() => {
    if (!isDragging) return;

    const onMove = (clientX: number) => {
      if (!draggingRef.current) return;
      const delta = clientX - dragStartX.current;
      // "left" direction: dragging right (positive delta) increases width
      // "right" direction: dragging left (negative delta) increases width
      const newWidth =
        direction === "left"
          ? dragStartWidth.current + delta
          : dragStartWidth.current - delta;
      setWidthState(clamp(newWidth, minWidth, maxWidth));
    };

    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      onMove(e.clientX);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      onMove(e.touches[0].clientX);
    };

    const onEnd = () => {
      draggingRef.current = false;
      setIsDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onEnd);

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [isDragging, direction, minWidth, maxWidth]);

  const onDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const clientX =
        "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
      dragStartX.current = clientX;
      dragStartWidth.current = width;
      draggingRef.current = true;
      setIsDragging(true);
    },
    [width],
  );

  return { width, isDragging, onDragStart, reset, setWidth };
}
