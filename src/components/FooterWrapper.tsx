"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer";

// Product workspaces manage their own viewport and navigation. Rendering the
// marketing footer beneath them both steals vertical space and creates a large
// unrelated panel when an internal tool uses a fixed-height canvas.
const HIDE_PATHS = [
  "/dashboard",
  "/studio",
  "/projects",
  "/agents",
  "/gallery",
  "/games",
  "/marketplace",
  "/settings",
  "/profile",
  "/wallet",
  "/memories",
  "/library",
  "/social",
];

export default function FooterWrapper() {
  const pathname = usePathname();
  const hidden = HIDE_PATHS.some((p) => pathname === p || pathname?.startsWith(p + "?") || pathname?.startsWith(p + "/"));
  if (hidden) return null;
  return <Footer />;
}
