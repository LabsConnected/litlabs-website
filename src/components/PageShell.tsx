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
      className={`relative min-h-[calc(100dvh-64px)] w-full overflow-x-hidden ${className}`}
      style={{
        color: T.textColor,
        background: `linear-gradient(180deg, ${(T.bgColor || "#050812")}d0 0%, ${(T.bgColor || "#050812")}d0 72%, #03050bd0 100%)`,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-70"
        style={{
          background: `radial-gradient(circle at 15% 0%, ${T.accentColor}1f, transparent 35%), radial-gradient(circle at 88% 8%, ${T.linkColor}18, transparent 32%)`,
        }}
      />
      {(title || subtitle) && (
        <header
          className="relative w-full overflow-hidden border-b px-4 py-7 sm:px-6 sm:py-9"
          style={{
            borderColor: T.borderColor + "55",
            background: `linear-gradient(110deg, ${T.boxBg || "#080c17"}e8, ${T.bgColor || "#050812"}d8)`,
            boxShadow: "0 18px 60px rgba(0,0,0,.18)",
          }}
        >
          <div className="mx-auto flex max-w-7xl items-center gap-4">
            {icon ? (
              <span
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border text-xl sm:h-14 sm:w-14"
                style={{
                  color: T.accentColor,
                  borderColor: T.accentColor + "55",
                  background: T.accentColor + "14",
                  boxShadow: `0 14px 40px ${T.accentColor}18`,
                }}
              >
                {icon}
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="hidden h-12 w-1 shrink-0 rounded-full sm:block"
                style={{
                  background: `linear-gradient(180deg, ${T.accentColor}, ${T.linkColor})`,
                  boxShadow: `0 0 24px ${T.accentColor}66`,
                }}
              />
            )}
            <div className="min-w-0">
              <div
                className="mb-1.5 text-[9px] font-black uppercase tracking-[.24em]"
                style={{ color: T.accentColor }}
              >
                LiTTree-LabStudios
              </div>
              {title && (
                <h1
                  className="truncate text-2xl font-black tracking-[-.035em] sm:text-3xl"
                  style={{ color: T.headerColor }}
                >
                  {title}
                </h1>
              )}
              {subtitle && (
                <p
                  className="mt-1 max-w-3xl text-xs leading-5 sm:text-sm sm:leading-6"
                  style={{ color: T.textMuted }}
                >
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${T.accentColor}aa, ${T.linkColor}88, transparent)`,
            }}
          />
        </header>
      )}
      <div className="relative w-full">{children}</div>
    </div>
  );
}
