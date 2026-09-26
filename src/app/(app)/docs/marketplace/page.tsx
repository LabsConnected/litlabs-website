import type { Metadata } from "next";
import { Suspense } from "react";
import MarketplaceDocsClient from "./MarketplaceDocsClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Marketplace",
  description:
    "The LiTT Marketplace roadmap: capabilities being built into LiTT, and what installable will mean when executors land.",
  path: "/docs/marketplace",
  index: true,
});

export default function MarketplaceDocsPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <MarketplaceDocsClient />
    </Suspense>
  );
}
