import type { Metadata } from "next";
import { Suspense } from "react";
import MarketplaceDocsClient from "./MarketplaceDocsClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Marketplace",
  description:
    "Install specialist agents from the LiTT Marketplace to extend what LiTT can do — code, content, research, support, analytics, and more.",
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
