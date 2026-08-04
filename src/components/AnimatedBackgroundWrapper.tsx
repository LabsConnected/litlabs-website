"use client";

import { usePathname } from "next/navigation";
import AnimatedBackground from "@/components/AnimatedBackground";

// Pages where the animated wallpaper would actively break a dense, interactive
// surface (terminal emulator, in-browser code editor). Everything else shows it.
const HIDE_BACKGROUND_PATHS = ["/admin/terminal"];

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

  return <AnimatedBackground />;
}
