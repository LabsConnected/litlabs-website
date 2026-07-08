"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { MOBILE_BOTTOM_ITEMS } from "@/lib/navigation";

const RESERVED_TOOLS = MOBILE_BOTTOM_ITEMS.map(
  (item) => new URLSearchParams(item.href.split("?")[1] ?? "").get("tool"),
).filter((tool): tool is string => Boolean(tool));

export default function MobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();

  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (href === "/") return pathname === "/";

    const tool = new URLSearchParams(query ?? "").get("tool");
    if (tool) {
      return pathname === path && searchParams.get("tool") === tool;
    }

    // Generic item (no tool query). For the shared "/studio" base, only treat
    // it as active when the current tool isn't owned by another bottom tab so
    // that exactly one tab is highlighted at a time.
    if (path === "/studio") {
      const current = searchParams.get("tool");
      return (
        pathname === "/studio" && (!current || !RESERVED_TOOLS.includes(current))
      );
    }

    return pathname === path || pathname?.startsWith(path + "/");
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-lg">
      <div
        className="grid min-h-[68px] grid-cols-5 items-center px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
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
              className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all"
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
              <span className="max-w-full truncate text-[9px] font-bold">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
