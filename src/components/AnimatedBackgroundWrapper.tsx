"use client";

import { usePathname } from "next/navigation";
import AnimatedBackground from "@/components/AnimatedBackground";

const SHOW_BACKGROUND_PATHS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/settings",
  "/dashboard",
  "/profile",
  "/marketplace",
  "/wallet",
  "/showcase",
  "/agents",
  "/gallery",
  "/library",
  "/projects",
  "/creator",
  "/social",
  "/deployments",
  "/wallet",
  "/showcase",
  "/order",
];

const HIDE_BACKGROUND_PATHS = ["/studio", "/admin/terminal", "/code", "/games"];

export default function AnimatedBackgroundWrapper() {
  const pathname = usePathname();

  if (!pathname) return null;
  if (
    HIDE_BACKGROUND_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  ) {
    return null;
  }
  if (
    !SHOW_BACKGROUND_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  ) {
    return null;
  }

  return <AnimatedBackground />;
}
