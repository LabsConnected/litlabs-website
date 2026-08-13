"use client";

/**
 * useViewportTier — SSR-safe viewport tier detection for the Ultra Vision
 * shell (Phase C2.1).
 *
 * Tiers:
 *   - "mobile":  <1024px  — LiTT is accessed via a trigger + overlay sheet
 *   - "laptop":  1024–1439px — LiTT defaults to collapsed (first-time users)
 *   - "desktop": >=1440px — LiTT defaults to expanded
 *
 * Returns `null` until the first client-side measurement completes, so the
 * initial client render matches the server render (no window access during
 * render) and no hydration mismatch is introduced. Consumers should treat
 * `null` as "not yet known" and avoid rendering tier-dependent chrome until
 * a real tier is available.
 */

import { useEffect, useState } from "react";

export type ViewportTier = "mobile" | "laptop" | "desktop";

const MOBILE_QUERY = "(max-width: 1023px)";
const DESKTOP_QUERY = "(min-width: 1440px)";

function computeTier(): ViewportTier {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  return "laptop";
}

export function useViewportTier(): ViewportTier | null {
  const [tier, setTier] = useState<ViewportTier | null>(null);

  useEffect(() => {
    setTier(computeTier());

    const mobileMql = window.matchMedia(MOBILE_QUERY);
    const desktopMql = window.matchMedia(DESKTOP_QUERY);

    const update = () => setTier(computeTier());

    mobileMql.addEventListener("change", update);
    desktopMql.addEventListener("change", update);
    return () => {
      mobileMql.removeEventListener("change", update);
      desktopMql.removeEventListener("change", update);
    };
  }, []);

  return tier;
}
