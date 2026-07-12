"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  padding = "normal",
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "compact" | "normal" | "loose";
  interactive?: boolean;
}) {
  const { tokens } = useTheme();
  const pad = {
    none: "",
    compact: "p-2",
    normal: "p-3 sm:p-4",
    loose: "p-4 sm:p-5",
  }[padding];

  return (
    <div
      className={cn(
        "rounded-xl sm:rounded-2xl border transition-all",
        pad,
        interactive && "cursor-pointer hover:border-primary/50 hover:bg-surfaceElevated",
        className,
      )}
      style={{
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
      }}
    >
      {children}
    </div>
  );
}
