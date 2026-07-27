import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "AI Agent and Creator Marketplace",
  description:
    "Discover community-built AI agents, creative tools, templates, themes, and resources for LiTTree LabStudios.",
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
