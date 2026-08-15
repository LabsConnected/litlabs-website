/**
 * useTerminalSize — reactive terminal viewport dimensions (spec §9).
 *
 * Exposes { columns, rows } and re-renders on resize. The main layout
 * calculates available regions from the actual viewport rather than
 * assuming 80×24.
 *
 * Defaults are conservative (80×24) so SSR/pipe contexts and tests
 * that stub out stdout don't crash. When stdout is unavailable we
 * return the defaults and never attach a listener.
 */

import { useState, useEffect } from "react";
import { useStdout } from "ink";

// ink v7 doesn't export Stdout directly; derive it from useStdout's return.
type InkStdout = NonNullable<ReturnType<typeof useStdout>["stdout"]>;

export interface TerminalSize {
  columns: number;
  rows: number;
}

const DEFAULT_SIZE: TerminalSize = { columns: 80, rows: 24 };

/** Minimum sane dimensions — guards against negative/zero from weird terminals. */
export function clampSize(size: TerminalSize): TerminalSize {
  return {
    columns: Math.max(20, size.columns | 0),
    rows: Math.max(8, size.rows | 0),
  };
}

/**
 * Responsive layout band (spec §10).
 *   wide    >= 120 columns
 *   standard 80–119 columns
 *   narrow  < 80 columns
 */
export type LayoutBand = "wide" | "standard" | "narrow";

export function layoutBand(columns: number): LayoutBand {
  if (columns >= 120) return "wide";
  if (columns >= 80) return "standard";
  return "narrow";
}

export function useTerminalSize(stdout?: InkStdout | null): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => {
    const cols = stdout?.columns ?? DEFAULT_SIZE.columns;
    const rows = stdout?.rows ?? DEFAULT_SIZE.rows;
    return clampSize({ columns: cols, rows });
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setSize(clampSize({ columns: stdout.columns ?? DEFAULT_SIZE.columns, rows: stdout.rows ?? DEFAULT_SIZE.rows }));
    };
    stdout.on("resize", onResize);
    // Sync once on mount in case the initial read was stale.
    onResize();
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  return size;
}
