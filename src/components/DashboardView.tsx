"use client";

import dynamic from "next/dynamic";
import AutonomicLoopBanner from "@/components/dashboard/AutonomicLoopBanner";

const CommandCenter = dynamic(
  () => import("@/components/dashboard/CommandCenter").then((m) => m.CommandCenter),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    ),
  },
);

export default function DashboardView() {
  return (
    <>
      <AutonomicLoopBanner />
      <CommandCenter />
    </>
  );
}
