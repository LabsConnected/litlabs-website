"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 border-b pb-5 sm:mb-8 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
      style={{ borderColor: `${tokens.border}60` }}
    >
      <div className="min-w-0">
        <h1
          className="text-xl font-black tracking-tight sm:text-2xl md:text-3xl"
          style={{ color: tokens.text }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="mt-1.5 text-xs leading-relaxed sm:text-sm"
            style={{ color: tokens.textMuted }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
