"use client";

import { ReactNode } from "react";
import { useLitConsoleTheme } from "@/components/lit-console/useLitConsoleTheme";

interface BentoCardProps {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: string;
  action?: ReactNode;
  footer?: ReactNode;
}

export function BentoCard({
  title,
  icon,
  children,
  className = "",
  accent,
  action,
  footer,
}: BentoCardProps) {
  const theme = useLitConsoleTheme();
  const accentColor = accent || theme.accentCyan;

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border ${className}`}
      style={{
        backgroundColor: theme.bg,
        borderColor: theme.borderSubtle,
        boxShadow: `0 0 0 1px ${theme.borderSubtle}, 0 12px 48px rgba(0,0,0,0.25)`,
      }}
    >
      {title && (
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: theme.borderSubtle }}
        >
          <div className="flex items-center gap-2">
            {icon && <span style={{ color: accentColor }}>{icon}</span>}
            <h3
              className="text-xs font-black uppercase tracking-[0.15em]"
              style={{ color: theme.textMuted }}
            >
              {title}
            </h3>
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="flex-1 p-4 min-h-0 overflow-hidden">{children}</div>
      {footer && (
        <div
          className="px-4 py-3 border-t text-xs"
          style={{ borderColor: theme.borderSubtle, color: theme.textDim }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
