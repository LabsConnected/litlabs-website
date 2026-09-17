"use client";

import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "neutral"
  | "primary"
  | "violet"
  | "success"
  | "warning"
  | "danger";

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-white/10 text-white/75 border-white/12",
  primary: "bg-cyan-400/15 text-cyan-200 border-cyan-300/30",
  // Restrained violet — meaningful accents only (e.g. creative/spark states).
  violet: "bg-violet-400/15 text-violet-200 border-violet-400/30",
  success: "bg-emerald-400/15 text-emerald-200 border-emerald-400/30",
  warning: "bg-amber-400/15 text-amber-200 border-amber-400/30",
  danger: "bg-red-400/15 text-red-200 border-red-400/30",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
