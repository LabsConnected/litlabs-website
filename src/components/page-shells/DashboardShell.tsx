"use client";

import { useTheme } from "@/context/ThemeContext";
import { Shimmer } from "./Shimmer";

/**
 * DashboardShell — truthful loading shell for /dashboard.
 *
 * Mirrors the v3 launchpad composition
 * (src/components/dashboard/v3/Dashboard.tsx):
 *   - utility row: "Home" label + Search / Developer pill buttons
 *   - BuildConsole: the universal "What do you want to make?" composer card
 *       + creation-type shortcut chips
 *   - RecentWork: recent projects rows
 *   - MediaDock: persistent footer player bar
 *
 * No pulsebar, no ops hero, no telemetry strips — the launchpad shows
 * nothing actionable while loading, and ActionNeededStrip renders nothing
 * until data says something failed.
 *
 * Skeleton blocks only — no project names, statuses, counts, or media.
 */
export default function DashboardShell() {
  const { tokens } = useTheme();

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      style={{ backgroundColor: tokens.background }}
      aria-label="Loading Dashboard"
      data-testid="dashboard-shell"
    >
      {/* Main content — one calm centered column */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-28 pt-5 md:px-6 md:pb-32 md:pt-7">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 md:gap-7">
          {/* Utility row */}
          <div
            className="flex items-center justify-between"
            data-testid="dashboard-shell-utility"
            aria-hidden="true"
          >
            <Shimmer width={48} height={12} />
            <div className="flex items-center gap-2">
              <Shimmer className="!rounded-full" width={104} height={40} />
              <Shimmer className="!rounded-full" width={120} height={40} />
            </div>
          </div>

          {/* Composer card */}
          <div
            className="rounded-3xl border p-6 md:p-10"
            style={{
              borderColor: tokens.border,
              backgroundColor: tokens.surface,
            }}
            data-testid="dashboard-shell-composer"
            aria-hidden="true"
          >
            <Shimmer height={32} width={280} />
            <Shimmer className="mt-3" height={16} width="60%" />
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Shimmer className="flex-1 !rounded-2xl" height={56} />
              <Shimmer className="!rounded-2xl" width={128} height={56} />
            </div>
            <div
              className="mt-7 flex flex-wrap gap-2.5"
              data-testid="dashboard-shell-chips"
            >
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <Shimmer key={i} className="!rounded-full" width={96} height={44} />
              ))}
            </div>
          </div>

          {/* Recent projects */}
          <div
            className="rounded-2xl border p-5 md:p-6"
            style={{
              borderColor: "rgba(255,255,255,0.06)",
              background: "rgba(18,18,21,0.7)",
            }}
            data-testid="dashboard-shell-recent-work"
            aria-hidden="true"
          >
            <Shimmer width={140} height={14} />
            <div className="mt-4 flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Shimmer width={40} height={40} />
                  <div className="flex-1 space-y-2">
                    <Shimmer height={12} width="70%" />
                    <Shimmer height={10} width="40%" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MediaDock footer */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center gap-3 border-t px-4"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
        data-testid="dashboard-shell-mediadock"
        aria-hidden="true"
      >
        <Shimmer width={48} height={48} />
        <div className="flex-1 space-y-2">
          <Shimmer height={12} width="40%" />
          <Shimmer height={10} width="25%" />
        </div>
        <Shimmer className="!rounded-full" width={40} height={40} />
        <Shimmer width={120} height={8} rounded="rounded-full" />
      </div>
    </div>
  );
}
