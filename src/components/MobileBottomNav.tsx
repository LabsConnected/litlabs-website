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
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname?.startsWith(href + "/");
  };

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#080910]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="grid h-16 grid-cols-5">
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
                className="relative flex min-h-11 flex-col items-center justify-center gap-0.5 transition-all"
                style={{ color: active ? T.accentColor : T.textMuted }}
              >
                {active && (
                  <span
                    className="absolute inset-x-2 top-0 h-[3px] rounded-full"
                    style={{
                      backgroundColor: T.accentColor,
                      boxShadow: `0 0 8px ${T.accentColor}80`,
                    }}
                  />
                )}
                <Icon
                  size={20}
                  style={active ? { filter: `drop-shadow(0 0 4px ${T.accentColor}60)` } : undefined}
                />
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
