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
        className="mobile-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur-xl"
        style={{ borderColor: `${T.borderColor}20` }}
      >
        <div
          className="flex items-center justify-around px-2 py-1"
          style={{ backgroundColor: `${T.bgColor}ee` }}
        >
          {primary.map((item) => {
            const Icon = item.icon;
            const active = item.href !== "#" && isActive(item.href);
            const isStudio = item.label === "Studio";
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`relative flex min-w-14 flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all ${isStudio ? "-mt-5" : ""}`}
                style={{
                  color: active
                    ? T.accentColor
                    : isStudio
                      ? T.bgColor
                      : T.textMuted,
                }}
              >
                {active && !isStudio && (
                  <span
                    className="absolute inset-0 rounded-xl opacity-15"
                    style={{ backgroundColor: T.accentColor }}
                  />
                )}
                {isStudio ? (
                  <span
                    className="grid h-12 w-12 place-items-center rounded-full shadow-[0_0_24px_rgba(139,92,246,.5)]"
                    style={{ backgroundColor: T.accentColor }}
                  >
                    <Icon size={24} aria-hidden="true" />
                  </span>
                ) : (
                  <Icon size={20} aria-hidden="true" />
                )}
                <span className="text-[9px] font-black">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={toggle}
            className="relative flex min-w-14 flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all"
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
