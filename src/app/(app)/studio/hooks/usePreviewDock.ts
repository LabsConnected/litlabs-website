"use client";

/**
 * usePreviewDock — placement state for the single preview host.
 *
 * Persists per-user layout prefs under the `littree:studio:*` keys:
 *   - placement (right/left/float/chat/fullscreen/split/stage)
 *   - float window rect
 *   - side-dock width
 *   - code+preview split fraction
 *   - in-chat card expanded flag
 *
 * `reset()` restores defaults (the "Reset Layout" control).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PREVIEW_CHAT_EXPANDED_KEY,
  PREVIEW_DOCK_DEFAULT_WIDTH,
  PREVIEW_DOCK_KEY,
  PREVIEW_DOCK_MAX_WIDTH,
  PREVIEW_DOCK_MIN_WIDTH,
  PREVIEW_DOCK_WIDTH_KEY,
  PREVIEW_FLOAT_RECT_KEY,
  PREVIEW_SPLIT_DEFAULT_FRACTION,
  PREVIEW_SPLIT_FRACTION_KEY,
  PREVIEW_SPLIT_MAX_FRACTION,
  PREVIEW_SPLIT_MIN_FRACTION,
  clampFloatRect,
  readStoredFloatRect,
  readStoredPlacement,
  type PreviewFloatRect,
  type PreviewPlacement,
} from "../lib/preview-dock";

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable — non-fatal
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export interface PreviewDockState {
  placement: PreviewPlacement;
  setPlacement: (p: PreviewPlacement) => void;
  dockWidth: number;
  setDockWidth: (w: number) => void;
  floatRect: PreviewFloatRect;
  setFloatRect: (r: PreviewFloatRect) => void;
  floatMinimized: boolean;
  setFloatMinimized: (m: boolean) => void;
  splitFraction: number;
  setSplitFraction: (f: number) => void;
  chatExpanded: boolean;
  setChatExpanded: (e: boolean) => void;
  reset: () => void;
  /** True after the first client-side read of persisted state. */
  hydrated: boolean;
}

export function usePreviewDock(): PreviewDockState {
  const [hydrated, setHydrated] = useState(false);
  const [placement, setPlacementState] = useState<PreviewPlacement>("right");
  const [dockWidth, setDockWidthState] = useState(PREVIEW_DOCK_DEFAULT_WIDTH);
  const [floatRect, setFloatRectState] = useState<PreviewFloatRect>({ x: 96, y: 96, w: 720, h: 520 });
  const [floatMinimized, setFloatMinimizedState] = useState(false);
  const [splitFraction, setSplitFractionState] = useState(PREVIEW_SPLIT_DEFAULT_FRACTION);
  const [chatExpanded, setChatExpandedState] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    hydratedRef.current = true;
    setPlacementState(readStoredPlacement());
    setDockWidthState(
      Math.min(
        PREVIEW_DOCK_MAX_WIDTH,
        Math.max(PREVIEW_DOCK_MIN_WIDTH, readNumber(PREVIEW_DOCK_WIDTH_KEY, PREVIEW_DOCK_DEFAULT_WIDTH)),
      ),
    );
    setFloatRectState(readStoredFloatRect());
    setSplitFractionState(
      Math.min(
        PREVIEW_SPLIT_MAX_FRACTION,
        Math.max(PREVIEW_SPLIT_MIN_FRACTION, readNumber(PREVIEW_SPLIT_FRACTION_KEY, PREVIEW_SPLIT_DEFAULT_FRACTION)),
      ),
    );
    try {
      setChatExpandedState(window.localStorage.getItem(PREVIEW_CHAT_EXPANDED_KEY) === "1");
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  // Re-clamp the float rect on viewport resize so the window can never be
  // stranded off-screen after a monitor/DPR change.
  useEffect(() => {
    const onResize = () => {
      setFloatRectState((r) => clampFloatRect(r, window.innerWidth, window.innerHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setPlacement = useCallback((p: PreviewPlacement) => {
    setPlacementState(p);
    write(PREVIEW_DOCK_KEY, p);
  }, []);

  const setDockWidth = useCallback((w: number) => {
    const clamped = Math.min(PREVIEW_DOCK_MAX_WIDTH, Math.max(PREVIEW_DOCK_MIN_WIDTH, Math.round(w)));
    setDockWidthState(clamped);
    write(PREVIEW_DOCK_WIDTH_KEY, String(clamped));
  }, []);

  const setFloatRect = useCallback((r: PreviewFloatRect) => {
    const clamped = clampFloatRect(r, window.innerWidth, window.innerHeight);
    setFloatRectState(clamped);
    write(PREVIEW_FLOAT_RECT_KEY, JSON.stringify(clamped));
  }, []);

  const setFloatMinimized = useCallback((m: boolean) => {
    setFloatMinimizedState(m);
  }, []);

  const setSplitFraction = useCallback((f: number) => {
    const clamped = Math.min(PREVIEW_SPLIT_MAX_FRACTION, Math.max(PREVIEW_SPLIT_MIN_FRACTION, f));
    setSplitFractionState(clamped);
    write(PREVIEW_SPLIT_FRACTION_KEY, String(clamped));
  }, []);

  const setChatExpanded = useCallback((e: boolean) => {
    setChatExpandedState(e);
    write(PREVIEW_CHAT_EXPANDED_KEY, e ? "1" : "0");
  }, []);

  const reset = useCallback(() => {
    setPlacementState("right");
    setDockWidthState(PREVIEW_DOCK_DEFAULT_WIDTH);
    setFloatRectState({ x: 96, y: 96, w: 720, h: 520 });
    setFloatMinimizedState(false);
    setSplitFractionState(PREVIEW_SPLIT_DEFAULT_FRACTION);
    setChatExpandedState(false);
    try {
      window.localStorage.removeItem(PREVIEW_DOCK_KEY);
      window.localStorage.removeItem(PREVIEW_DOCK_WIDTH_KEY);
      window.localStorage.removeItem(PREVIEW_FLOAT_RECT_KEY);
      window.localStorage.removeItem(PREVIEW_SPLIT_FRACTION_KEY);
      window.localStorage.removeItem(PREVIEW_CHAT_EXPANDED_KEY);
    } catch {
      // ignore
    }
  }, []);

  return {
    placement,
    setPlacement,
    dockWidth,
    setDockWidth,
    floatRect,
    setFloatRect,
    floatMinimized,
    setFloatMinimized,
    splitFraction,
    setSplitFraction,
    chatExpanded,
    setChatExpanded,
    reset,
    hydrated,
  };
}
