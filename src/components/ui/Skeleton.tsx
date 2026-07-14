"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  width,
  height,
}: {
  className?: string;
  width?: string | number;
  height?: string | number;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className={cn("animate-pulse rounded-lg", className)}
      style={{
        width,
        height,
        backgroundColor: tokens.border,
      }}
    />
  );
}
