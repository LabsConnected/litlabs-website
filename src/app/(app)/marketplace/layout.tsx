import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Marketplace",
  description:
    "Browse the LiTT marketplace for agents, skills, and workflows that extend what your AI project operator can do.",
  path: "/marketplace",
  index: true,
});

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
