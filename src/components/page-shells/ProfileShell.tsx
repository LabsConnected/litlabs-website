"use client";

import { useTheme } from "@/context/ThemeContext";
import { Shimmer } from "./Shimmer";

/**
 * ProfileShell — truthful loading shell for /profile.
 *
 * Mirrors ProfilePage's real layout (src/app/(app)/profile/page.tsx):
 *   - ProfileCover banner (280px desktop / 170px mobile)
 *   - ProfileIdentity: avatar ring, name/level, username, bio, meta chips,
 *     action buttons
 *   - ProfileTabs bar (overview/projects/agents/artifacts/posts/activity/about)
 *   - content grid (1fr + 340px right rail):
 *       ProfileOverview sections + ProfileRightRail sections
 *   - CreatorActionPanel
 *
 * Skeleton blocks only — no display name, username, bio, skills,
 * achievements, or level text.
 */
export default function ProfileShell() {
  const { tokens } = useTheme();

  return (
    <div
      aria-label="Loading Profile"
      data-testid="profile-shell"
      style={{ minHeight: "100dvh", color: tokens.text }}
    >
      <div className="mx-auto w-full max-w-[1500px] px-3 pb-[100px] pt-3 sm:px-6 md:px-7 md:pt-6">
        {/* Cover banner */}
        <div
          className="h-[170px] overflow-hidden rounded-2xl md:h-[280px]"
          style={{ backgroundColor: tokens.surface }}
          data-testid="profile-shell-cover"
          aria-hidden="true"
        >
          <Shimmer className="h-full w-full" rounded="rounded-2xl" />
        </div>

        {/* Identity row */}
        <div
          className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end"
          data-testid="profile-shell-identity"
        >
          <div aria-hidden="true" className="shrink-0">
            <Shimmer className="!rounded-full" width={112} height={112} />
          </div>
          <div className="min-w-0 flex-1" aria-hidden="true">
            <div className="flex items-center gap-2">
              <Shimmer width={224} height={28} />
              <Shimmer width={52} height={20} rounded="rounded-full" />
            </div>
            <Shimmer className="mt-2" width={160} height={16} />
            <Shimmer className="mt-3" width="75%" height={14} />
            <div className="mt-3 flex flex-wrap gap-2">
              {[0, 1, 2].map((i) => (
                <Shimmer key={i} width={96} height={26} rounded="rounded-full" />
              ))}
            </div>
          </div>
          <div className="flex shrink-0 gap-2" aria-hidden="true">
            <Shimmer width={112} height={40} rounded="rounded-xl" />
            <Shimmer width={40} height={40} rounded="rounded-xl" />
          </div>
        </div>

        {/* Tabs bar */}
        <div
          className="mt-6 flex gap-1 overflow-x-auto border-b"
          style={{ borderColor: tokens.border }}
          data-testid="profile-shell-tabs"
          aria-hidden="true"
        >
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex min-h-[44px] shrink-0 items-center px-4">
              <Shimmer width={64} height={14} />
            </div>
          ))}
        </div>

        {/* Content grid: overview + 340px right rail */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <div className="flex min-w-0 flex-col gap-5" data-testid="profile-shell-overview">
            {["Featured Work", "Recent Projects"].map((section) => (
              <div
                key={section}
                className="rounded-2xl border p-5"
                style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
                aria-hidden="true"
              >
                <Shimmer width={144} height={16} />
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <Shimmer className="aspect-video w-full" />
                      <Shimmer height={12} width="80%" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex min-w-0 flex-col gap-5" data-testid="profile-shell-right-rail">
            {["About", "Creator Level", "Skills"].map((section) => (
              <div
                key={section}
                className="rounded-2xl border p-5"
                style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
                aria-hidden="true"
              >
                <Shimmer width={112} height={14} />
                <div className="mt-4 flex flex-col gap-2.5">
                  {[0, 1, 2].map((i) => (
                    <Shimmer key={i} height={12} width={i === 2 ? "60%" : "90%"} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Creator action panel */}
        <div
          className="mt-8 flex flex-col items-start justify-between gap-4 rounded-2xl border p-6 sm:flex-row sm:items-center"
          style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
          data-testid="profile-shell-action-panel"
          aria-hidden="true"
        >
          <div className="flex-1 space-y-2">
            <Shimmer height={18} width={192} />
            <Shimmer height={12} width="65%" />
          </div>
          <Shimmer width={144} height={44} rounded="rounded-xl" />
        </div>
      </div>
    </div>
  );
}
