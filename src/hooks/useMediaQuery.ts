"use client";

import { useEffect, useState } from "react";

/**
 * useMediaQuery — SSR-safe media query subscription.
 *
 * Returns `false` until the first client-side evaluation so the initial
 * client render matches the server render (no window access during
 * render, no hydration mismatch). Same contract as useViewportTier.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const update = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}
