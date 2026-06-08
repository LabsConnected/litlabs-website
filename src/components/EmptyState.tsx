"use client";

import { ReactNode } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Ghost } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title = "Nothing here yet",
  description = "This space is waiting for your creations.",
  action,
  className = "",
}: EmptyStateProps) {
  const { resolvedColors } = useTheme();

  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-16 px-4 ${className}`}
    >
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
        style={{
          backgroundColor: resolvedColors.accentColor + "10",
          border: `1px solid ${resolvedColors.accentColor}20`,
        }}
      >
        {icon || (
          <Ghost size={28} style={{ color: resolvedColors.accentColor }} />
        )}
      </div>
      <h3
        className="text-sm font-bold mb-1"
        style={{ color: resolvedColors.textColor }}
      >
        {title}
      </h3>
      <p
        className="text-xs max-w-sm mb-4"
        style={{ color: resolvedColors.textMuted }}
      >
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}
