"use client";

import nextDynamic from "next/dynamic";

const DashboardView = nextDynamic(
  () => import("@/components/DashboardView"),
  { ssr: false },
);

export default function DashboardPage() {
  return <DashboardView />;
}
