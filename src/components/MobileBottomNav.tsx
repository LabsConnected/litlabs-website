"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { MOBILE_BOTTOM_ITEMS } from "@/lib/navigation";
import MobileMoreSheet from "@/components/MobileMoreSheet";

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
                className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-2 transition-all"
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

      <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
