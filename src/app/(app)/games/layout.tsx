import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo";
import { isFeatureEnabled } from "@/config/feature-flags";

export const metadata: Metadata = buildMetadata({
  title: "Free Browser Games",
  description:
    "Play free browser games and discover interactive creations from the LiTTree LabStudios community.",
  path: "/games",
  index: false,
});

export default function GamesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Keep one server-side guard for the complete Games route tree. The runtime
  // is enabled in the canonical feature configuration, while this remains a
  // safe kill switch for an operational rollback.
  if (!isFeatureEnabled("retroGameRuntime")) {
    notFound();
  }

  return children;
}
