"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { NavAuth } from "@/components/ClerkAuth";
import {
  LayoutDashboard,
  Sparkles,
  Bot,
  Wallet,
  Settings,
  Zap,
} from "lucide-react";

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Studio", href: "/studio", icon: Sparkles },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Wallet", href: "/wallet", icon: Wallet },
  { label: "Settings", href: "/settings", icon: Settings },
];

export default function TopNavbar() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname?.startsWith(href) ?? false;
  };

  return (
    <header
      className="sticky top-0 z-30 border-b px-4 sm:px-6"
      style={{
        backgroundColor: `${T.bgColor}f2`,
        borderColor: `${T.borderColor}20`,
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2"
            aria-label="Go to Dashboard"
          >
            <span
              className="grid h-8 w-8 place-items-center rounded-lg border"
              style={{
                backgroundColor: `${T.accentColor}14`,
                borderColor: `${T.accentColor}35`,
                color: T.accentColor,
                boxShadow: `inset 0 0 14px ${T.accentColor}20`,
              }}
            >
              <Zap size={16} />
            </span>
            <span className="bg-gradient-to-r from-white via-violet-200 to-fuchsia-400 bg-clip-text text-base font-black tracking-[.16em] text-transparent">
              LiTT
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="relative flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5"
                  style={{
                    color: active ? T.textColor : T.textMuted,
                    backgroundColor: active
                      ? `${T.accentColor}15`
                      : "transparent",
                  }}
                >
                  {active && (
                    <span
                      className="absolute inset-x-0 -bottom-[9px] h-[2px] rounded-full"
                      style={{ backgroundColor: T.accentColor }}
                    />
                  )}
                  <Icon size={15} style={{ color: active ? T.accentColor : undefined }} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <NavAuth linkColor={T.accentColor} />
        </div>
      </div>
    </header>
  );
}
