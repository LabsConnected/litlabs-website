"use client";

/**
 * useIsPhone — SSR-safe phone-tier detection for the responsive Studio
 * phone tier.
 *
 * The responsive phone tier (StudioShell's phone column) activates below
 * 768px. This is deliberately narrower than useViewportTier's "mobile"
 * (<1024px): the 768–1023px range keeps the existing tablet sheet model,
 * while phones get the same StudioShell with bottom navigation and a
 * sheet inspector.
 *
 * Returns `null` until the first client-side measurement completes so the
 * initial client render matches the server render (no hydration mismatch).
 */

import { useEffect, useState } from "react";

const PHONE_QUERY = "(max-width: 767px)";

function computeIsPhone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(PHONE_QUERY).matches;
}

export function useIsPhone(): boolean | null {
  const [isPhone, setIsPhone] = useState<boolean | null>(null);

  useEffect(() => {
    setIsPhone(computeIsPhone());
    const mql = window.matchMedia(PHONE_QUERY);
    const update = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isPhone;
}
