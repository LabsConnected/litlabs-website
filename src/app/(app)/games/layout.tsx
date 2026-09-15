import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo";
import { isFeatureEnabled } from "@/config/feature-flags";

export async function generateMetadata(): Promise<Metadata> {
  // While the games section is gated off, every route in this segment
  // answers 404 — so the tab title must not advertise "Free Browser Games".
  if (!isFeatureEnabled("retroGameRuntime")) {
    return {
      title: "404 — Page Not Found",
      robots: { index: false, follow: false },
    };
  }
  return buildMetadata({
    title: "Free Browser Games",
    description:
      "Play free browser games and discover interactive creations from the LiTTree LabStudios community.",
    path: "/games",
    index: false,
  });
}

export default function GamesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Games are not part of the public V1 product. Guarding the segment layout
  // covers every nested route in one place — /games, /games/retro,
  // /games/retro/play/[gameId], /games/retro/test, /games/cloud, /games/dos —
  // all of which currently answer 200 in production, including the internal
  // test route. Navbar and NavbarWrapper already hide the links behind the
  // same flag, so this closes the direct-URL path they left open.
  if (!isFeatureEnabled("retroGameRuntime")) {
    notFound();
  }

  return children;
}
