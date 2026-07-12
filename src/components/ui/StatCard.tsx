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
        "rounded-xl sm:rounded-2xl border p-3 sm:p-4 transition-all",
        className,
      )}
      style={{ backgroundColor: tokens.surface, borderColor: tokens.border }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>
            {label}
          </div>
          <div className="mt-1 text-xl font-black sm:text-2xl" style={{ color: tokens.text }}>
            {value}
          </div>
        </div>
        {icon && <div style={{ color: tokens.primary }}>{icon}</div>}
      </div>
      {trend && (
        <div
          className="mt-2 text-[10px] font-semibold"
          style={{ color: trend.positive ? tokens.success : trend.positive === false ? tokens.danger : tokens.textMuted }}
        >
          {trend.value}
        </div>
      )}
    </div>
  );
}
