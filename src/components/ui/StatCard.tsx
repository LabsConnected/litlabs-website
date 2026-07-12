"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon,
  trend,
  className,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: string; positive?: boolean };
  className?: string;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl sm:rounded-2xl border p-3 sm:p-4 transition-all hover:scale-[1.01]",
        className,
      )}
      style={{
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
        boxShadow: `0 0 0 1px ${tokens.primary}08`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle at 0% 0%, ${tokens.primary}08 0%, transparent 60%)`,
        }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <div
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: tokens.textMuted }}
          >
            {label}
          </div>
          <div
            className="mt-1.5 text-xl font-black sm:text-2xl"
            style={{ color: tokens.text }}
          >
            {value}
          </div>
        </div>
        {icon && (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
            style={{
              backgroundColor: `${tokens.primary}12`,
              color: tokens.primary,
              boxShadow: `0 0 12px ${tokens.primary}20`,
            }}
          >
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <div
          className="relative mt-2 text-[10px] font-bold"
          style={{
            color: trend.positive
              ? tokens.success
              : trend.positive === false
                ? tokens.danger
                : tokens.textMuted,
          }}
        >
          {trend.value}
        </div>
      )}
    </div>
  );
}
