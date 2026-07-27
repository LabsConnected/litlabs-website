import type { Metadata } from "next";
import { Suspense } from "react";
import DocsPageClient from "./DocsPageClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Docs",
  description:
    "Quick-start documentation for LiTTree LabStudios: agents, Studio, flows, gallery, and support.",
  path: "/docs",
  index: true,
});

export default function DocsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#03050a]" />}>
      <DocsPageClient />
    </Suspense>
  );
}
