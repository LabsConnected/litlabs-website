"use client";

import { ReactNode } from "react";
import { useTheme } from "@/context/ThemeContext";

interface PageShellProps {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export default function PageShell({
  title,
  subtitle,
  icon,
  className = "",
  children,
}: PageShellProps) {
  const { resolvedColors: T } = useTheme();

  return (
    <div
      className={`min-h-screen w-full ${className}`}
      style={{ color: T.textColor }}
    >
      {(title || subtitle) && (
        <div
          className="w-full px-4 sm:px-6 py-6 border-b"
          style={{ borderColor: T.borderColor + "20" }}
        >
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            {icon && (
              <span
                className="text-2xl flex items-center"
                style={{ color: T.accentColor }}
              >
                {icon}
              </span>
            )}
            <div>
              {title && (
                <h1
                  className="text-xl sm:text-2xl font-black tracking-tight"
                  style={{ color: T.headerColor }}
                >
                  {title}
                </h1>
              )}
              {subtitle && (
                <p
                  className="text-xs sm:text-sm mt-0.5 opacity-60"
                  style={{ color: T.textMuted }}
                >
                  {subtitle}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="w-full">{children}</div>
    </div>
  );
}
