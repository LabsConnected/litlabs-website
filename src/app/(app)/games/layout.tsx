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
  // The games segment is flag-gated: flipping retroGameRuntime back off
  // makes every nested route in this segment 404 again — /games,
  // /games/retro, /games/retro/play/[gameId], /games/cloud, /games/dos.
  // Navbar, NavbarWrapper and the app-shell nav all hide/show the links
  // behind the same flag, so no surface ever links to a 404.
  if (!isFeatureEnabled("retroGameRuntime")) {
    notFound();
  }

  return children;
}
