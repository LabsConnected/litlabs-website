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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-lg">
        <div
          className="flex items-center justify-around py-2"
          style={{
            backgroundColor: `${T.bgColor}f0`,
            borderColor: `${T.borderColor}30`,
          }}
        >
          {MOBILE_BOTTOM_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const isMore = item.href === "#menu";
            return (
              <Link
                key={item.label}
                href={isMore ? "#" : item.href}
                onClick={isMore ? (e) => { e.preventDefault(); setMoreOpen(true); } : undefined}
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all"
                style={{
                  color: active ? T.accentColor : T.textMuted,
                }}
              >
                <div className="relative">
                  <Icon size={20} />
                  {item.badge && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center text-[8px] font-bold rounded-full bg-[#ff00a0] text-white px-1">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-bold">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* More menu slide-up */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="relative max-h-[80vh] overflow-y-auto rounded-t-2xl border-t shadow-2xl"
            style={{
              backgroundColor: `${T.bgColor}f0`,
              borderColor: `${T.borderColor}30`,
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: `${T.borderColor}30` }}>
              <span className="text-sm font-bold" style={{ color: T.textColor }}>More</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: T.textMuted }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              {MOBILE_MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all"
                    style={{
                      backgroundColor: active ? `${T.accentColor}12` : `${T.boxBg}60`,
                      border: `1px solid ${active ? T.accentColor : T.borderColor}30`,
                      color: active ? T.accentColor : T.textMuted,
                    }}
                  >
                    <Icon size={22} />
                    <span className="text-[10px] font-bold text-center">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
