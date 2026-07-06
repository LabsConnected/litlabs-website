"use client";

import { useTheme } from "@/context/ThemeContext";
import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const { resolvedColors: T } = useTheme();

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center"
      style={{
        backgroundColor: `${T.borderColor}10`,
        borderColor: `${T.borderColor}20`,
      }}
    >
      {icon && (
        <div className="text-2xl" style={{ color: T.textMuted }}>
          {icon}
        </div>
      )}
      <div>
        <div
          className="text-sm font-semibold"
          style={{ color: T.textColor }}
        >
          {title}
        </div>
        {description && (
          <div className="mt-1 text-xs" style={{ color: T.textMuted }}>
            {description}
          </div>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
