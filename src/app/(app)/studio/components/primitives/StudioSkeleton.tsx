"use client";

import { studioColors, studioRadius } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioSkeleton — loading placeholder primitive.
 *
 * Never shows fake data. Just a shimmering placeholder.
 *
 * Phase 10.2 — Design tokens and primitives
 * ───────────────────────────────────────────────────────────────── */

interface StudioSkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
  testId?: string;
}

export function StudioSkeleton({ width = "100%", height = 16, rounded = false, testId }: StudioSkeletonProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: rounded ? "9999px" : studioRadius.sm,
        background: `linear-gradient(90deg, ${studioColors.card} 0%, ${studioColors.elevated} 50%, ${studioColors.card} 100%)`,
        backgroundSize: "200% 100%",
        animation: "studio-skeleton-shimmer 1.5s ease-in-out infinite",
      }}
      data-testid={testId ?? "studio-skeleton"}
    />
  );
}
