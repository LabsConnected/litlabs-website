"use client";

/**
 * ProjectSkeleton — card-shaped loading placeholders for /projects,
 * in the user's normal theme colors (the standard light look, per
 * Larry's all-light ruling 2026-11-13). Used by the route's
 * loading.tsx and by the page's own loading state so both moments
 * look like the same screen.
 */

import { useTheme } from "@/context/ThemeContext";

export default function ProjectSkeleton({ count = 6 }: { count?: number }) {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-label="Loading projects"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse flex-col gap-3 rounded-2xl border p-4"
          style={{ backgroundColor: `${T.boxBg}b8`, borderColor: `${T.borderColor}45` }}
        >
          <div
            className="h-28 rounded-xl"
            style={{ backgroundColor: `${T.accentColor}12` }}
          />
          <div
            className="h-4 w-2/3 rounded"
            style={{ backgroundColor: `${T.textColor}14` }}
          />
          <div
            className="h-3 w-1/2 rounded"
            style={{ backgroundColor: `${T.textColor}0d` }}
          />
          <div
            className="h-3 w-1/3 rounded"
            style={{ backgroundColor: `${T.textColor}0d` }}
          />
        </div>
      ))}
    </div>
  );
}
