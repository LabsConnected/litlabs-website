"use client";

import { useTheme } from "@/context/ThemeContext";
import { Shimmer } from "./Shimmer";

/**
 * DiscoverShell — truthful loading shell for /discover.
 *
 * Mirrors DiscoverPage's signed-in layout (src/app/(app)/discover/page.tsx):
 * the shared LiTTAppShell frame —
 *   - left sidebar column (feed nav rows; hidden below lg, where the
 *     real page collapses it into a drawer)
 *   - content region: hero band (live dot + title + Live badge +
 *     quick-action chips), composer card, sticky feed tab bar
 *     (for-you / following / trending), post cards (avatar, name/meta,
 *     body, media, reaction row)
 *   - right rail card (Trending; hidden below xl, like the real rail)
 *
 * Skeleton blocks only — no post text, names, counts, or images.
 */
export default function DiscoverShell() {
  const { tokens } = useTheme();

  return (
    <div
      className="w-full"
      style={{ backgroundColor: tokens.background }}
      aria-label="Loading Discover feed"
      data-testid="discover-shell"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-stretch">
        {/* Sidebar column */}
        <aside
          aria-hidden="true"
          className="sticky top-0 hidden h-screen w-[280px] shrink-0 flex-col gap-6 overflow-y-auto border-r px-4 py-6 lg:flex"
          style={{
            backgroundColor: tokens.surface,
            borderColor: tokens.border,
          }}
          data-testid="discover-shell-sidebar"
        >
          <div>
            <Shimmer width={44} height={10} />
            <div className="mt-3 flex flex-col gap-1">
              {[0, 1, 2].map((i) => (
                <Shimmer key={i} height={44} rounded="rounded-xl" />
              ))}
            </div>
          </div>
          <div>
            <Shimmer width={56} height={10} />
            <div className="mt-3 flex flex-col gap-1">
              {[0, 1].map((i) => (
                <Shimmer key={i} height={44} rounded="rounded-xl" />
              ))}
            </div>
          </div>
          <Shimmer height={132} rounded="rounded-2xl" />
        </aside>

        {/* Content region */}
        <div className="min-w-0 flex-1 px-3 pb-28 sm:px-6">
          {/* Hero band */}
          <header
            className="mt-6 rounded-2xl border p-4 sm:p-5"
            style={{
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
            }}
            data-testid="discover-shell-header"
          >
            <div className="flex min-h-[44px] items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tokens.success }}
              />
              <Shimmer width={120} height={22} />
              <Shimmer width={36} height={12} />
            </div>
            <Shimmer className="mt-2" width="55%" height={14} />
            <div className="mt-4 flex gap-2" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <Shimmer key={i} width={104} height={44} rounded="rounded-xl" />
              ))}
            </div>
          </header>

          {/* Composer card */}
          <div
            className="mt-5 border-b p-3"
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
            <div className="mx-auto flex max-w-4xl" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex min-h-[44px] flex-1 items-center justify-center">
                  <Shimmer width={76} height={14} />
                </div>
              ))}
            </div>
          </div>

          {/* Post cards */}
          <div className="mx-auto max-w-4xl" data-testid="discover-shell-posts">
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

        {/* Right rail column */}
        <aside
          aria-hidden="true"
          className="sticky top-0 hidden h-screen w-[320px] shrink-0 overflow-y-auto border-l px-4 py-6 xl:block"
          style={{
            backgroundColor: tokens.surfaceElevated,
            borderColor: tokens.border,
          }}
          data-testid="discover-shell-rail"
        >
          <div
            className="rounded-2xl border p-4"
            style={{
              backgroundColor: tokens.surface,
              borderColor: tokens.border,
            }}
          >
            <Shimmer width={110} height={16} />
            <Shimmer className="mt-2" width="80%" height={11} />
            <div className="mt-4 flex flex-col gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Shimmer className="!rounded-full" width={32} height={32} />
                  <div className="flex-1 space-y-1.5 pt-0.5">
                    <Shimmer height={11} width="65%" />
                    <Shimmer height={11} width="95%" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
