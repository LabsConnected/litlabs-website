"use client";

import dynamic from "next/dynamic";
import { DashboardThemeProvider } from "@/components/dashboard/DashboardThemeProvider";

/**
 * DashboardView — renders the v3 dashboard composition.
 *
 * The v3 dashboard is the real dashboard: it uses the existing
 * MediaHubProvider (mounted globally in the app layout) and
 * MusicPlayerContext via the useMediaDock coordination hook.
 * No FloatingMusicWidget — the v3 MediaDock is the persistent
 * media player, consuming the same authoritative state.
 */
const Dashboard = dynamic(
  () =>
    import("@/components/dashboard/v3/Dashboard").then(
      (m) => m.Dashboard,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    ),
  },
);

export default function DashboardView() {
  return (
    <DashboardThemeProvider>
      <Dashboard />
    </DashboardThemeProvider>
  );
}
