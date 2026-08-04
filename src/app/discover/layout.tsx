import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Discover",
  description:
    "Discover creations, meet collaborators, and explore the LiTTree creative social platform.",
  path: "/discover",
  index: true,
});

export default function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
