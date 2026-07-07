"use client";

import { ReactNode } from "react";

// Neon LiT OS theme constants (matches lit-console-theme.ts)
const B = {
  bg: "#101018",
  border: "#252538",
  accent: "#00f5ff",
  headerColor: "#94a3b8",
  textMuted: "#64748b",
};

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
  const accentColor = accent || B.accent;

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border ${className}`}
      style={{
        backgroundColor: B.bg,
        borderColor: `${B.border}80`,
        boxShadow: `0 0 0 1px ${B.border}40, 0 12px 48px rgba(0,0,0,0.25)`,
      }}
    >
      {title && (
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: `${B.border}60` }}
        >
          <div className="flex items-center gap-2">
            {icon && <span style={{ color: accentColor }}>{icon}</span>}
            <h3
              className="text-xs font-black uppercase tracking-[0.15em]"
              style={{ color: B.headerColor }}
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
          style={{ borderColor: `${B.border}40`, color: B.textMuted }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
