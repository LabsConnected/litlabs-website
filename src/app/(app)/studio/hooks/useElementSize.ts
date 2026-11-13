"use client";

import { useEffect, useState, type RefObject } from "react";
import type { CanvasSize } from "../lib/canvas-fit";

/**
 * Track an element's content-box size with ResizeObserver.
 *
 * Image previews need a definite pixel box before they can fit both an
 * image's width and height. Percentage max-height alone is not enough
 * when the preview is nested inside shrink-to-fit wrappers.
 */
export function useElementSize<T extends HTMLElement>(
  ref: RefObject<T | null>,
): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const update = (width: number, height: number) => {
      const next = {
        width: Math.max(0, Math.floor(width)),
        height: Math.max(0, Math.floor(height)),
      };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
