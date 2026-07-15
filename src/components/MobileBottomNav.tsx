"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { MOBILE_BOTTOM_ITEMS } from "@/lib/navigation";
import { MoreHorizontal, X } from "lucide-react";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname?.startsWith(href) ?? false;
  };

  const primary = MOBILE_BOTTOM_ITEMS.slice(0, 4);
  const overflow = MOBILE_BOTTOM_ITEMS.slice(4);
  const anyOverflowActive = overflow.some((item) => isActive(item.href));

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
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`relative flex min-w-14 flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all ${item.label === "Create" ? "-mt-5" : ""}`}
                style={{ color: active ? T.accentColor : T.textMuted }}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-xl opacity-15"
                    style={{ backgroundColor: T.accentColor }}
                  />
                )}
                <span className={item.label === "Create" ? "grid h-12 w-12 place-items-center rounded-full bg-violet-600 text-white shadow-[0_0_24px_rgba(139,92,246,.5)]" : ""}><Icon size={item.label === "Create" ? 24 : 20} /></span>
                <span className="text-[9px] font-black">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="relative flex min-w-14 flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all"
            style={{
              color:
                moreOpen || anyOverflowActive ? T.accentColor : T.textMuted,
            }}
            aria-label="More navigation"
          >
            {(moreOpen || anyOverflowActive) && (
              <span
                className="absolute inset-0 rounded-xl opacity-15"
                style={{ backgroundColor: T.accentColor }}
              />
            )}
            {moreOpen ? <X size={20} /> : <MoreHorizontal size={20} />}
            <span className="text-[9px] font-black">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-2 right-2 z-50 rounded-2xl border p-3 shadow-2xl md:hidden"
            style={{
              backgroundColor: T.boxBg,
              borderColor: `${T.borderColor}30`,
            }}
          >
            <div className="grid grid-cols-3 gap-2">
              {overflow.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-col items-center gap-1 rounded-xl px-2 py-3 transition-all"
                    style={{
                      color: active ? T.accentColor : T.textMuted,
                      backgroundColor: active
                        ? `${T.accentColor}15`
                        : "transparent",
                    }}
                  >
                    <Icon size={20} />
                    <span className="text-[9px] font-black">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
