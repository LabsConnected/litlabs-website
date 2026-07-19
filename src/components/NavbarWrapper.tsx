"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, Search, Zap } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

const desktopLinks = [
  ["Dashboard", "/dashboard"],
  ["Studio", "/studio"],
  ["Agents", "/agents"],
  ["Gallery", "/gallery"],
] as const;

export default function NavbarWrapper() {
  const { resolvedColors: T } = useTheme();
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
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-2 font-black text-sm" style={{ color: T.headerColor }}><Zap size={18} style={{ color: T.accentColor }} />LiTT</Link>
        <nav className="ml-5 flex items-center gap-1">
          {desktopLinks.map(([label, href]) => <Link key={href} href={href} className="rounded-lg px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5" style={{ color: T.textMuted }}>{label}</Link>)}
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
