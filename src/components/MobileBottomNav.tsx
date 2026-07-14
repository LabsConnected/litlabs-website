"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { MOBILE_BOTTOM_ITEMS } from "@/lib/navigation";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname?.startsWith(href) ?? false;
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className="mobile-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-[100] border-t backdrop-blur-xl"
      style={{ borderColor: `${T.borderColor}20` }}
    >
      <div
        className="flex items-center gap-1 overflow-x-auto px-2 py-1 scrollbar-hide"
        style={{ backgroundColor: `${T.bgColor}ee` }}
      >
        {MOBILE_BOTTOM_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className="relative flex min-w-14 flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all"
              style={{ color: active ? T.accentColor : T.textMuted }}
            >
              {active && (
                <span
                  className="absolute inset-0 rounded-xl opacity-15"
                  style={{ backgroundColor: T.accentColor }}
                />
              )}
              <Icon size={20} />
              <span className="text-[9px] font-black">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
