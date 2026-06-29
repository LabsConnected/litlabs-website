"use client";

import { usePathname } from "next/navigation";
import AnimatedBackground from "@/components/AnimatedBackground";

const SHOW_BACKGROUND_PATHS = ["/", "/sign-in", "/sign-up"];

export default function AnimatedBackgroundWrapper() {
  const pathname = usePathname();

  // Only run the animated canvas on public/landing pages.
  // On internal pages this returns null so the canvas is never mounted.
  if (
    !pathname ||
    !SHOW_BACKGROUND_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  ) {
    return null;
  }

  return <AnimatedBackground />;
}
