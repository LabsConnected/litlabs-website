"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export type BadgeStatus =
  | "idle"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "pending"
  | "offline";

const statusLabels: Record<BadgeStatus, string> = {
  idle: "Idle",
  running: "Running",
  success: "Complete",
  warning: "Attention",
  error: "Error",
  info: "Info",
  pending: "Pending",
  offline: "Offline",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: BadgeStatus;
  label?: string;
  className?: string;
}) {
  const { tokens } = useTheme();

  const colorMap: Record<BadgeStatus, string> = {
    idle: tokens.textMuted,
    running: tokens.primary,
    success: tokens.success,
    warning: tokens.warning,
    error: tokens.danger,
    info: tokens.secondary,
    pending: tokens.warning,
    offline: tokens.textMuted,
  };

  const color = colorMap[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        className,
      )}
      style={{
        color,
        backgroundColor: color + "15",
        border: `1px solid ${color}30`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: status === "running" ? `0 0 6px ${color}` : undefined,
        }}
      />
      {label || statusLabels[status]}
    </span>
  );
}
