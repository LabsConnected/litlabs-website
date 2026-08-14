import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Showcase",
  description:
    "Explore featured projects, architecture maps, and case studies built with LiTTree LabStudios AI creative platform.",
  path: "/showcase",
  index: true,
});

export default function ShowcaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
