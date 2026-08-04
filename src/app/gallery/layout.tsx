import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "AI Creation Gallery",
  description:
    "Explore apps, artwork, experiments, and public projects created on LiTTree LabStudios.",
  path: "/gallery",
  index: true,
});

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
