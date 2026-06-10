"use client";

import { ReactNode } from "react";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  className?: string;
  fullWidth?: boolean;
  animate?: boolean;
  headerAction?: ReactNode;
}

export default function PageShell({
  children,
  title,
  subtitle,
  icon,
  breadcrumbs,
  className = "",
  fullWidth = false,
  animate = true,
  headerAction,
}: PageShellProps) {
  const { resolvedColors } = useTheme();

  return (
    <main
      className={`min-h-screen pt-16 pb-12 ${animate ? "animate-fadeInUp" : ""} ${className}`}
      style={{ color: resolvedColors.textColor }}
    >
      <div className={fullWidth ? "" : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-[11px] font-mono mb-4 opacity-60">
            <Link href="/" className="hover:opacity-100 transition-opacity" style={{ color: resolvedColors.linkColor }}>
              Home
            </Link>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight size={12} style={{ color: resolvedColors.textMuted }} />
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:opacity-100 transition-opacity" style={{ color: resolvedColors.linkColor }}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span style={{ color: resolvedColors.textMuted }}>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        {(title || subtitle) && (
          <div className="mb-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {icon && (
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: `linear-gradient(135deg, ${resolvedColors.accentColor}20, ${resolvedColors.headerColor}15)`, border: `1px solid ${resolvedColors.accentColor}30` }}>
                    {icon}
                  </div>
                )}
                <div>
                  {title && (
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ background: `linear-gradient(90deg, ${resolvedColors.headerColor}, ${resolvedColors.accentColor})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                      {title}
                    </h1>
                  )}
                  {subtitle && (
                    <p className="mt-1 text-sm" style={{ color: resolvedColors.textMuted }}>
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              {headerAction && <div className="shrink-0 mt-1">{headerAction}</div>}
            </div>
            <div className="mt-4 h-px" style={{ background: `linear-gradient(90deg, ${resolvedColors.accentColor}40, transparent)` }} />
          </div>
        )}

        {children}
      </div>
    </main>
  );
}
