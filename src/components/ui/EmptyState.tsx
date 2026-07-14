"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl sm:rounded-2xl border border-dashed p-6 sm:p-8 text-center",
        className,
      )}
      style={{ borderColor: tokens.border, color: tokens.textMuted }}
    >
      {icon && <div className="mb-3 opacity-40">{icon}</div>}
      <div className="text-sm font-bold" style={{ color: tokens.text }}>
        {title}
      </div>
      {description && (
        <div className="mt-1 max-w-xs text-xs">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
