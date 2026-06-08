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
            {title && (
              <div className="flex items-center justify-between gap-4">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: resolvedColors.headerColor }}>
                  {title}
                </h1>
                {headerAction && <div className="shrink-0">{headerAction}</div>}
              </div>
            )}
            {subtitle && (
              <p className="mt-2 text-sm opacity-70 max-w-2xl" style={{ color: resolvedColors.textMuted }}>
                {subtitle}
              </p>
            )}
          </div>
        )}

        {children}
      </div>
    </main>
  );
}
