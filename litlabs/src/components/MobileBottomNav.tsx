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
    return pathname?.startsWith(href);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-lg">
      <div
        className="flex min-h-[68px] items-center justify-around px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
        style={{
          backgroundColor: `${T.bgColor}f0`,
          borderColor: `${T.borderColor}30`,
        }}
      >
        {MOBILE_BOTTOM_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isLiT = item.href === "/studio?tool=chat";
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex min-w-[56px] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition-all"
              style={{
                color: active ? T.accentColor : T.textMuted,
                backgroundColor: isLiT && active ? `${T.accentColor}15` : undefined,
              }}
            >
              <div
                className={isLiT ? "rounded-full p-1" : ""}
                style={isLiT ? { backgroundColor: active ? `${T.accentColor}25` : `${T.accentColor}12` } : undefined}
              >
                <Icon size={isLiT ? 22 : 20} style={isLiT ? { color: T.accentColor } : undefined} />
              </div>
              <span className="text-[9px] font-bold">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
