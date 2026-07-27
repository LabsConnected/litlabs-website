import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Free Browser Games",
  description:
    "Play free browser games and discover interactive creations from the LiTTree LabStudios community.",
  path: "/games",
  index: true,
});

export default function GamesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
