"use client";

import { useSearchParams, useRouter } from "next/navigation";
import nextDynamic from "next/dynamic";
import { useEffect } from "react";

const DashboardView = nextDynamic(
  () => import("@/components/DashboardView"),
  { ssr: false },
);

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const app = searchParams.get("app");

  // Compatibility redirect: old /dashboard?app=music bookmarks → Studio
  useEffect(() => {
    if (app === "music") {
      router.replace("/studio?tool=music");
    }
  }, [app, router]);

  if (app === "music") {
    return null;
  }

  return <DashboardView />;
}
