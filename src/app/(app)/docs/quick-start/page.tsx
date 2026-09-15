import type { Metadata } from "next";
import { Suspense } from "react";
import QuickStartClient from "./QuickStartClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Quick Start",
  description:
    "Step-by-step: create an account, open Studio, build your first project with LiTT, preview it, and deploy — in about ten minutes.",
  path: "/docs/quick-start",
  index: true,
});

export default function QuickStartPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <QuickStartClient />
    </Suspense>
  );
}
