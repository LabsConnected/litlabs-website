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
        className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        style={{ borderColor: `${T.borderColor}20` }}
      >
        <div
          className="grid h-[72px] grid-cols-5 items-center px-2"
          style={{ backgroundColor: `${T.bgColor}ee` }}
        >
          {primary.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const isStudio = item.label === "Studio";
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-all ${isStudio ? "-mt-6" : ""}`}
                style={{ color: active ? T.accentColor : T.textMuted }}
              >
                {active && !isStudio && (
                  <span
                    className="absolute inset-0 rounded-xl opacity-15"
                    style={{ backgroundColor: T.accentColor }}
                  />
                )}
                <span
                  className={
                    isStudio
                      ? "grid h-14 w-14 place-items-center rounded-full bg-violet-600 text-white shadow-[0_0_24px_rgba(139,92,246,.65)]"
                      : "grid h-8 w-8 place-items-center"
                  }
                >
                  <Icon size={isStudio ? 24 : 20} aria-hidden="true" />
                </span>
                <span
                  className={`text-[10px] font-black ${isStudio ? "text-violet-300" : ""}`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-all"
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
            className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-2 right-2 z-50 rounded-2xl border p-3 shadow-2xl md:hidden"
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
