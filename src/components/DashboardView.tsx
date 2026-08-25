"use client";

import dynamic from "next/dynamic";
import { DashboardThemeProvider } from "@/components/dashboard/DashboardThemeProvider";
import FloatingMusicWidget from "@/components/dashboard/FloatingMusicWidget";

const MissionControlDashboard = dynamic(
  () =>
    import("@/components/dashboard/v2/MissionControlDashboard").then(
      (m) => m.MissionControlDashboard,
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
      <MissionControlDashboard />
      <FloatingMusicWidget />
    </DashboardThemeProvider>
  );
}
