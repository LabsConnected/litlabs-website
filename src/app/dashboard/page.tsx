"use client";

import { useSearchParams } from "next/navigation";
import nextDynamic from "next/dynamic";

const DashboardView = nextDynamic(
  () => import("@/components/DashboardView"),
  { ssr: false },
);

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const app = searchParams.get("app");

  // Compatibility redirect: old /dashboard?app=music bookmarks → Studio
  if (app === "music") {
    if (typeof window !== "undefined") {
      window.location.href = "/studio?tool=music";
    }
    return null;
  }

  return <DashboardView />;
}
