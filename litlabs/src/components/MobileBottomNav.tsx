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
        className="flex items-center justify-around py-2 px-1"
        style={{
          backgroundColor: `${T.bgColor}f0`,
          borderColor: `${T.borderColor}30`,
        }}
      >
        {MOBILE_BOTTOM_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isLiT = item.href === "/lit-console";
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all"
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
