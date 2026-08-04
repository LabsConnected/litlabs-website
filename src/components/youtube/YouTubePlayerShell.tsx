"use client";

/**
 * YouTubePlayerShell — renders the appropriate YouTube player UI
 * based on the current route and dock mode.
 *
 * - On /dashboard: renders YouTubeDock (full card)
 * - On other authenticated pages: renders YouTubeMiniPlayer
 *   when dockMode is "mini" or "docked" (docked means the user
 *   was on dashboard and navigated away — show mini)
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
  "/profile/",
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

  // Dashboard renders its own dock directly — shell shows nothing there
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return null;
  }

  // Other authenticated pages get the mini player
  // (docked mode means user was on dashboard — show mini elsewhere)
  return <YouTubeMiniPlayer />;
}
