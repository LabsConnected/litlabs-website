"use client";

/**
 * useAssetsRefresh — lightweight event-based refresh mechanism for
 * the Assets panel.
 *
 * When a creator registers a new asset, it calls `notifyAssetsChanged()`.
 * The AssetsPanel listens for this event and re-fetches.
 *
 * This avoids:
 *   - Aggressive polling
 *   - Full page reloads
 *   - Duplicate fetches from drawer visibility toggles
 */

import { useEffect, useState, useCallback } from "react";

const ASSETS_CHANGED_EVENT = "litt:assets:changed";

/** Notify all listeners that the assets list has changed. */
export function notifyAssetsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASSETS_CHANGED_EVENT));
}

/**
 * Hook that returns a refresh counter that increments whenever
 * the assets list changes. Components can use this as a dependency
 * to trigger re-fetches.
 */
export function useAssetsRefreshTrigger(): number {
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    const handler = () => setTrigger((t) => t + 1);
    window.addEventListener(ASSETS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(ASSETS_CHANGED_EVENT, handler);
  }, []);

  return trigger;
}

/**
 * Hook that returns a manual refresh function.
 * Useful for "refresh" buttons.
 */
export function useManualAssetsRefresh(): () => void {
  return useCallback(() => {
    notifyAssetsChanged();
  }, []);
}
