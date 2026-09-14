import type { Metadata } from "next";
import { Suspense } from "react";
import TroubleshootingClient from "./TroubleshootingClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Troubleshooting",
  description:
    "Fix common LiTT launch issues: preview not starting, terminal disconnected, deployment approvals, model/provider failures, and CLI connectivity.",
  path: "/docs/troubleshooting",
  index: true,
});

export default function TroubleshootingPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <TroubleshootingClient />
    </Suspense>
  );
}
