"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { X } from "lucide-react";
import { MOBILE_BOTTOM_ITEMS, MOBILE_MORE_ITEMS } from "@/lib/navigation";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "#menu") return false;
    if (href === "/") return pathname === "/";
    return pathname?.startsWith(href);
  };

  return (
    <>
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
            const isMore = item.href === "#menu";
            return (
              <Link
                key={item.label}
                href={isMore ? "#" : item.href}
                onClick={
                  isMore
                    ? (e) => {
                        e.preventDefault();
                        setMoreOpen(true);
                      }
                    : undefined
                }
                className="relative flex min-w-[3.5rem] flex-col items-center gap-0.5 px-2 py-2 rounded-xl transition-all"
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

      {/* More menu slide-up */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[10000] flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="relative max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-t shadow-2xl"
            style={{
              backgroundColor: `${T.bgColor}f8`,
              borderColor: `${T.accentColor}20`,
            }}
          >
            <div
              className="mx-auto mt-3 h-1 w-10 rounded-full opacity-30"
              style={{ backgroundColor: T.borderColor }}
            />
            <div
              className="flex items-center justify-between px-5 py-3 border-b"
              style={{ borderColor: `${T.borderColor}20` }}
            >
              <span
                className="text-sm font-black"
                style={{ color: T.textColor }}
              >
                More
              </span>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                style={{ color: T.textMuted }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4 min-[390px]:gap-2.5 min-[390px]:p-5">
              {MOBILE_MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-col items-center gap-2 p-3.5 rounded-2xl transition-all hover:scale-[1.02]"
                    style={{
                      backgroundColor: active
                        ? `${T.accentColor}15`
                        : `${T.boxBg}80`,
                      border: `1px solid ${active ? T.accentColor : T.borderColor}25`,
                      color: active ? T.accentColor : T.textMuted,
                      boxShadow: active
                        ? `0 0 16px ${T.accentColor}20`
                        : undefined,
                    }}
                  >
                    <Icon size={22} />
                    <span className="text-[10px] font-black text-center leading-tight">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
            <div className="pb-safe px-5 pb-6" />
          </div>
        </div>
      )}
    </>
  );
}
