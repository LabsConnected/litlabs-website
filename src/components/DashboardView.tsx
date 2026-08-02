"use client";

import dynamic from "next/dynamic";

const DashboardV2 = dynamic(
  () => import("@/components/dashboard/v2/DashboardV2").then((m) => m.DashboardV2),
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
  return <DashboardV2 />;
}
