import type { Metadata } from "next";
import { Suspense } from "react";
import DocsOverviewClient from "./DocsOverviewClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Docs",
  description:
    "LiTT documentation: what LiTT is, how Studio works, projects, chat and agents, preview, terminal, deployment, CLI, marketplace, and approvals.",
  path: "/docs",
  index: true,
});

export default function DocsPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <DocsOverviewClient />
    </Suspense>
  );
}
