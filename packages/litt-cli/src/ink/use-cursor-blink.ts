/**
 * useCursorBlink — software-rendered cursor blink (spec: ~500–600ms).
 *
 * The terminal's native cursor is hidden by Ink; the composer renders
 * its own. Behavior:
 *   - visible toggles every `intervalMs` (default 550ms)
 *   - `poke()` after a keystroke holds the cursor STEADY for
 *     `steadyMs` (default 700ms) so typing reads as immediate, then
 *     blinking resumes
 *   - `enabled=false` freezes blinking (caller hides the cursor, e.g.
 *     while the composer is disabled)
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface CursorBlink {
  /** True while the cursor should be painted (blink phase). */
  visible: boolean;
  /** True while the cursor is held steady after a keystroke. */
  steady: boolean;
  /** Call after any keypress that edits the draft. */
  poke: () => void;
}

export function useCursorBlink(
  intervalMs = 550,
  steadyMs = 700,
  enabled = true,
  restartKey: number | string | null = null,
): CursorBlink {
  const [visible, setVisible] = useState(true);
  const [steady, setSteady] = useState(false);
  const steadyUntilRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const poke = useCallback(() => {
    steadyUntilRef.current = Date.now() + steadyMs;
    setSteady(true);
    setVisible(true);
  }, [steadyMs]);

  // Blink loop — runs ONLY while enabled. When disabled (busy, overlay,
  // scrolled history) there is NO self-initiated repaint from the
  // composer: the caret is a focus signal, not a render churn source.
  useEffect(() => {
    if (!enabledRef.current) {
      setVisible(true);
      return;
    }
    const timer = setInterval(() => {
      // While steady (recent typing), keep the cursor solid.
      if (Date.now() < steadyUntilRef.current) return;
      setSteady(false);
      setVisible((v) => !v);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  // Event-based focus restoration: when the store bumps the focus epoch
  // (overlay closed, run settled, return-to-live), restart the caret in
  // its STEADY phase exactly once. Renders and timer ticks never change
  // the epoch, so this can never loop.
  const restartKeyRef = useRef(restartKey);
  useEffect(() => {
    if (restartKeyRef.current === restartKey) return;
    restartKeyRef.current = restartKey;
    if (!enabledRef.current) return;
    steadyUntilRef.current = Date.now() + steadyMs;
    setSteady(true);
    setVisible(true);
  }, [restartKey, steadyMs]);

  return { visible, steady, poke };
}
