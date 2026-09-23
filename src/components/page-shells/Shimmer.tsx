"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

interface ShimmerProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  /** Border radius. Defaults to rounded-lg like the shared Skeleton. */
  rounded?: string;
}

/**
 * Shimmer — the truthful loading block used by all polish-program route
 * shells. Decorative only (aria-hidden): it marks where real content will
 * appear and never carries fake text, images, or data.
 */
export function Shimmer({
  className,
  width,
  height,
  rounded = "rounded-lg",
}: ShimmerProps) {
  const { tokens } = useTheme();
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse", rounded, className)}
      style={{
        width,
        height,
        backgroundColor: tokens.border,
      }}
    />
  );
}
