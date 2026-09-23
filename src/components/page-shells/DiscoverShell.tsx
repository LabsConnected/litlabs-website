"use client";

import { useTheme } from "@/context/ThemeContext";
import { Shimmer } from "./Shimmer";

/**
 * DiscoverShell — truthful loading shell for /discover.
 *
 * Mirrors DiscoverPage's real layout (src/app/(app)/discover/page.tsx):
 *   - max-w-2xl column: compact feed header (live dot + title + Live badge)
 *   - composer card (post-type tabs, input, post button)
 *   - sticky feed tab bar (for-you / following / trending)
 *   - post cards (avatar, name/meta, body, media, reaction row)
 *
 * Skeleton blocks only — no post text, names, counts, or images.
 */
export default function DiscoverShell() {
  const { tokens } = useTheme();

  return (
    <div
      className="mx-auto w-full max-w-2xl min-w-0 px-3 pb-28"
      aria-label="Loading Discover feed"
      data-testid="discover-shell"
    >
      {/* Compact feed header */}
      <header
        className="flex min-h-[44px] items-center gap-2 py-2"
        data-testid="discover-shell-header"
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: tokens.success }}
        />
        <Shimmer width={96} height={20} />
        <Shimmer width={36} height={12} />
      </header>

      {/* Composer card */}
      <div
        className="border-b p-3"
        style={{
          borderColor: tokens.border,
          backgroundColor: tokens.surface,
        }}
        data-testid="discover-shell-composer"
      >
        <div className="flex gap-1 overflow-x-auto pb-1" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <Shimmer key={i} width={72} height={32} rounded="rounded-full" />
          ))}
        </div>
        <Shimmer className="mt-1 w-full" height={64} rounded="rounded-xl" />
        <div className="mt-2 flex justify-end">
          <Shimmer width={88} height={36} rounded="rounded-xl" />
        </div>
      </div>

      {/* Sticky feed tab bar */}
      <div
        className="sticky top-0 z-40"
        style={{
          backgroundColor: tokens.background,
          borderBottom: `1px solid ${tokens.border}`,
        }}
        data-testid="discover-shell-tabs"
      >
        <div className="mx-auto flex max-w-2xl" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-[44px] flex-1 items-center justify-center">
              <Shimmer width={76} height={14} />
            </div>
          ))}
        </div>
      </div>

      {/* Post cards */}
      <div data-testid="discover-shell-posts">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="min-w-0 border-b px-3 py-3 sm:px-4 sm:py-4"
            style={{
              borderColor: tokens.border,
              backgroundColor: tokens.surface,
            }}
            aria-hidden="true"
          >
            <div className="flex items-start gap-2.5">
              <Shimmer className="!rounded-full" width={44} height={44} />
              <div className="flex-1 space-y-2 pt-1">
                <Shimmer height={12} width="40%" />
                <Shimmer height={10} width="25%" />
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <Shimmer height={14} width="95%" />
              <Shimmer height={14} width="70%" />
            </div>
            <Shimmer className="mt-3" height={120} width="100%" />
            <div className="mt-3 flex justify-between">
              {[0, 1, 2, 3, 4].map((j) => (
                <Shimmer key={j} height={28} width={44} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
