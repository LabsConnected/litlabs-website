"use client";

/**
 * YouTubePlayerShell — renders the appropriate YouTube player UI
 * based on the current route and dock mode.
 *
 * - On authenticated pages: renders YouTubeMiniPlayer
 *   when dockMode is "mini" or "docked" (docked is the mode the
 *   retired dashboard set — the mini player carries it elsewhere)
 * - On public pages: renders nothing
 * - When dockMode is "hidden": renders nothing
 *
 * The YouTubePlayerProvider must wrap this component.
 */

import { usePathname } from "next/navigation";
import { useYouTubePlayer } from "@/context/YouTubePlayerContext";
import { YouTubeMiniPlayer } from "@/components/youtube/YouTubeMiniPlayer";

const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/sign-in",
  "/sign-up",
  "/privacy",
  "/terms",
  "/cookies",
  "/docs",
  "/pricing",
  "/gallery",
  "/showcase",
  "/marketplace",
  "/agents",
  "/u",
  "/games",
];

function isPublicPath(path: string) {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export function YouTubePlayerShell() {
  const pathname = usePathname() || "/";
  const { dockMode } = useYouTubePlayer();

  // Never show on public pages
  if (isPublicPath(pathname)) return null;

  // Never show if hidden
  if (dockMode === "hidden") return null;

  // Authenticated pages get the mini player (Studio carries the full
  // media dock itself; the retired dashboard was the shell's only
  // suppression case and it no longer exists as a page).
  return <YouTubeMiniPlayer />;
}
