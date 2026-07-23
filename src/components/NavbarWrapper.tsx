"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, Search, Sparkles } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { usePathname } from "next/navigation";

const desktopLinks = [
  ["Dashboard", "/dashboard"],
  ["Studio", "/studio"],
  ["Agents", "/agents"],
  ["Gallery", "/gallery"],
  ["Marketplace", "/marketplace"],
  ["Games", "/games"],
] as const;

export default function NavbarWrapper() {
  const { resolvedColors: T } = useTheme();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-30 hidden h-14 items-center justify-between border-b px-6 transition-colors md:flex"
      style={{
        backgroundColor: `${T.bgColor}${scrolled ? "f2" : "e6"}`,
        borderColor: `${T.borderColor}20`,
        backdropFilter: "blur(14px)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 font-black"
          style={{ color: T.headerColor }}
          aria-label="LiTTree-LabStudios home"
        >
          <span
            className="grid h-8 w-8 place-items-center rounded-xl border"
            style={{
              color: T.accentColor,
              borderColor: `${T.accentColor}45`,
              backgroundColor: `${T.accentColor}12`,
              boxShadow: `0 0 20px ${T.accentColor}18`,
            }}
          >
            <Sparkles size={16} />
          </span>
          <span className="hidden text-sm tracking-[-.025em] lg:inline">LiTTree-LabStudios</span>
          <span className="text-sm tracking-[-.025em] lg:hidden">LiTTree</span>
        </Link>
        <nav className="ml-2 flex items-center gap-0.5 lg:ml-4 lg:gap-1">
          {desktopLinks.map(([label, href]) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-2 py-2 text-[11px] font-bold transition-colors hover:bg-white/5 lg:px-3 lg:text-xs ${
                  label === "Marketplace" ? "hidden xl:block" : ""
                }`}
                style={{
                  color: active ? T.accentColor : T.textMuted,
                  backgroundColor: active ? `${T.accentColor}12` : "transparent",
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Search"
        >
          <Search size={18} />
        </button>
        <button
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Notifications"
        >
          <Bell size={18} />
        </button>
      </div>
    </header>
  );
}
