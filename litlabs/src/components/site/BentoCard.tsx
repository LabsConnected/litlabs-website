"use client";

import { useTheme } from "@/context/ThemeContext";
import { ReactNode } from "react";

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
  const { resolvedColors: T } = useTheme();
  const accentColor = accent || T.accentColor;

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border ${className}`}
      style={{
        backgroundColor: `${T.boxBg}80`,
        borderColor: `${T.borderColor}30`,
        boxShadow: `0 0 0 1px ${T.borderColor}18, 0 12px 48px rgba(0,0,0,0.25)`,
      }}
    >
      {title && (
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: `${T.borderColor}20` }}
        >
          <div className="flex items-center gap-2">
            {icon && <span style={{ color: accentColor }}>{icon}</span>}
            <h3
              className="text-xs font-black uppercase tracking-[0.15em]"
              style={{ color: T.headerColor }}
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
          style={{ borderColor: `${T.borderColor}20`, color: T.textMuted }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
