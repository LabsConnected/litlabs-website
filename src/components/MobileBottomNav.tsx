"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { Home, Sparkles, Plus, Compass, User } from "lucide-react";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href;
    return pathname === href || pathname?.startsWith(href + "/");
  };

  const items = [
    { label: "Home", href: "/dashboard", icon: Home, active: isActive("/dashboard", true), exact: true },
    { label: "Studio", href: "/studio", icon: Sparkles, active: pathname?.startsWith("/studio") },
  ];

  const rightItems = [
    { label: "Discover", href: "/discover", icon: Compass, active: pathname?.startsWith("/discover") },
    { label: "Me", href: "/profile", icon: User, active: pathname?.startsWith("/profile") || pathname?.startsWith("/settings") },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#080910]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <div className="relative grid h-16 grid-cols-5 items-center">
        {/* Left 2 items */}
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="relative flex min-h-11 flex-col items-center justify-center gap-0.5 transition-all"
              style={{ color: item.active ? T.accentColor : T.textMuted }}
            >
              {item.active && (
                <span
                  className="absolute inset-x-3 top-0 h-0.75 rounded-full"
                  style={{
                    backgroundColor: T.accentColor,
                    boxShadow: `0 0 8px ${T.accentColor}80`,
                  }}
                />
              )}
              <Icon
                size={20}
                style={item.active ? { filter: `drop-shadow(0 0 4px ${T.accentColor}60)` } : undefined}
              />
              <span className="text-[9px] font-black">{item.label}</span>
            </Link>
          );
        })}

        {/* Center Create button */}
        <Link
          href="/studio?tool=chat"
          className="relative flex flex-col items-center justify-center"
          aria-label="Create"
        >
          <span
            className="grid h-12 w-12 place-items-center rounded-2xl border-2 transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor}, ${T.accentColor}cc)`,
              borderColor: `${T.accentColor}60`,
              boxShadow: `0 4px 20px ${T.accentColor}40, 0 0 12px ${T.accentColor}30`,
            }}
          >
            <Plus size={24} className="text-white" />
          </span>
        </Link>

        {/* Right 2 items */}
        {rightItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="relative flex min-h-11 flex-col items-center justify-center gap-0.5 transition-all"
              style={{ color: item.active ? T.accentColor : T.textMuted }}
            >
              {item.active && (
                <span
                  className="absolute inset-x-3 top-0 h-0.75 rounded-full"
                  style={{
                    backgroundColor: T.accentColor,
                    boxShadow: `0 0 8px ${T.accentColor}80`,
                  }}
                />
              )}
              <Icon
                size={20}
                style={item.active ? { filter: `drop-shadow(0 0 4px ${T.accentColor}60)` } : undefined}
              />
              <span className="text-[9px] font-black">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
