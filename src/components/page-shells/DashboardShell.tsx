"use client";

import { useTheme } from "@/context/ThemeContext";
import { Shimmer } from "./Shimmer";

/**
 * DashboardShell — truthful loading shell for /dashboard.
 *
 * Mirrors the v3 dashboard composition
 * (src/components/dashboard/v3/Dashboard.tsx):
 *   - ProjectPulseBar: status strip (h-8, status dots + command trigger)
 *   - main grid (max-w-7xl, lg:grid-cols-12):
 *       left lg:col-span-7: ContinueWorking hero + QuickStart grid
 *       right lg:col-span-5: RecentWork rows + RecentMedia grid
 *   - MediaDock: persistent footer player bar
 *
 * Skeleton blocks only — no project names, statuses, counts, or media.
 */
export default function DashboardShell() {
  const { tokens } = useTheme();

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      aria-label="Loading Dashboard"
      data-testid="dashboard-shell"
    >
      {/* ProjectPulseBar */}
      <div
        className="flex h-8 w-full items-center gap-3 overflow-x-auto border-b px-4 md:gap-6 md:px-6"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
        data-testid="dashboard-shell-pulsebar"
        aria-hidden="true"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex shrink-0 items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: tokens.border }}
            />
            <Shimmer width={72} height={10} />
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-28 pt-6 md:px-6 md:pb-32">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left column: ContinueWorking hero + QuickStart */}
          <div className="flex flex-col gap-6 lg:col-span-7">
            <div
              className="relative overflow-hidden rounded-xl border p-6"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
              data-testid="dashboard-shell-hero"
              aria-hidden="true"
            >
              <Shimmer height={16} width={128} />
              <Shimmer className="mt-3" height={32} width={192} />
              <div className="mt-4 flex gap-3">
                <Shimmer width={128} height={40} rounded="rounded-md" />
                <Shimmer width={112} height={40} rounded="rounded-md" />
              </div>
            </div>

            <div data-testid="dashboard-shell-quickstart" aria-hidden="true">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col items-center justify-center gap-3 rounded-lg border p-4"
                    style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
                  >
                    <Shimmer className="!rounded-full" width={40} height={40} />
                    <Shimmer width={72} height={12} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column: RecentWork + RecentMedia */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            <div
              className="rounded-xl border p-4"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
              data-testid="dashboard-shell-recent-work"
              aria-hidden="true"
            >
              <Shimmer width={120} height={14} />
              <div className="mt-4 flex flex-col gap-3">
                {[0, 1, 2, 3].map((i) => (
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

            <div
              className="rounded-xl border p-4"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
              data-testid="dashboard-shell-recent-media"
              aria-hidden="true"
            >
              <Shimmer width={120} height={14} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <Shimmer key={i} className="aspect-video w-full" />
                ))}
              </div>
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
