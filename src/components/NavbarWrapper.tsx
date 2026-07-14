"use client";

import { useState, useEffect } from "react";
import { Menu, Bell, Search } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export default function NavbarWrapper({
  onMenuClick,
}: {
  onMenuClick?: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-30 hidden md:flex items-center justify-between px-4 sm:px-6 h-14 transition-colors"
      style={{
        backgroundColor: scrolled ? `${T.bgColor}e6` : "transparent",
        borderBottom: scrolled
          ? `1px solid ${T.borderColor}20`
          : "1px solid transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        <span className="font-black text-sm" style={{ color: T.headerColor }}>
          LiTT
        </span>
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
