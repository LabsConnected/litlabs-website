"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
  elevated = false,
  padding = "normal",
  border = true,
}: {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  padding?: "none" | "compact" | "normal" | "loose";
  border?: boolean;
}) {
  const { tokens } = useTheme();
  const pad = {
    none: "",
    compact: "p-2 sm:p-3",
    normal: "p-3 sm:p-4",
    loose: "p-4 sm:p-6",
  }[padding];

  return (
    <div
      className={cn(
        "rounded-xl sm:rounded-2xl transition-all",
        pad,
        border && "border",
        elevated && "shadow-lg",
        className,
      )}
      style={{
        backgroundColor: elevated ? tokens.surfaceElevated : tokens.surface,
        borderColor: tokens.border,
      }}
    >
      {children}
    </div>
  );
}
