"use client";

import nextDynamic from "next/dynamic";

const DashboardView = nextDynamic(() => import("@/components/DashboardView"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a12] text-[#e0e0e0]">
      <div className="text-center">
        <div className="text-3xl mb-4 animate-pulse">⚡</div>
        <div className="text-xs font-bold tracking-[0.15em] uppercase text-[#94a3b8] animate-pulse">
          Loading command center…
        </div>
      </div>
    </div>
  ),
});

export default function DashboardPage() {
  return <DashboardView />;
}
