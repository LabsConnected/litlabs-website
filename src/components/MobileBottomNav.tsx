"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useNavDrawer } from "@/context/NavDrawerContext";
import { MOBILE_BOTTOM_ITEMS } from "@/lib/navigation";
import { MoreHorizontal } from "lucide-react";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();
  const { toggle } = useNavDrawer();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname?.startsWith(href) ?? false;
  };

  const primary = MOBILE_BOTTOM_ITEMS.slice(0, 4);

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="mobile-bottom-nav md:hidden fixed z-[100] overflow-hidden rounded-2xl border backdrop-blur-xl"
        style={{
          borderColor: `${T.borderColor}35`,
          boxShadow: "0 14px 45px rgba(0,0,0,.48)",
        }}
      >
        <div
          className="flex items-center justify-around px-1 py-1.5"
          style={{ backgroundColor: `${T.bgColor}f2` }}
        >
          {primary.map((item) => {
            const Icon = item.icon;
            const active = item.href !== "#" && isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-2 transition-all"
                style={{
                  color: active ? T.accentColor : T.textMuted,
                }}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-xl opacity-15"
                    style={{ backgroundColor: T.accentColor }}
                  />
                )}
                <Icon size={20} aria-hidden="true" />
                <span className="text-[9px] font-black">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={toggle}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-2 transition-all"
            style={{
              color: T.textMuted,
            }}
            aria-label="Open navigation"
          >
            <MoreHorizontal size={20} />
            <span className="text-[9px] font-black">More</span>
          </button>
        </div>
      </nav>

    </>
  );
}
