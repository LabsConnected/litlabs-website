"use client";

import { useState, useEffect, useRef } from "react";
import {
  Bell,
  Search,
  Settings,
  Home,
  Gamepad2,
  Store,
  User,
  Images,
  Wand2,
  Sparkles,
  Wallet,
  Users,
  LayoutGrid,
  BookOpen,
  Code2,
  ChevronDown,
  BarChart3,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";
import dynamic from "next/dynamic";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false },
);

export default function NavbarWrapper() {
  const { resolvedColors: T } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const mainLinks = [
    { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/studio?tool=chat", label: "LiTTree Agent", icon: Wand2 },
    { href: "/agents", label: "Agents", icon: Sparkles },
    { href: "/gallery", label: "Gallery", icon: Images },
    { href: "/marketplace", label: "Marketplace", icon: Store },
    { href: "/games/cloud", label: "Games", icon: Gamepad2 },
  ];

  const moreLinks = [
    { href: "/social", label: "Social", icon: Users },
    { href: "/wallet", label: "Wallet", icon: Wallet },
    { href: "/library/files", label: "Library", icon: LayoutGrid },
    { href: "/memories", label: "Memories", icon: BookOpen },
    { href: "/code", label: "Code", icon: Code2 },
    { href: "/docs", label: "Docs", icon: BookOpen },
    { href: "/showcase", label: "Showcase", icon: Images },
    { href: "/profile", label: "Profile", icon: User },
  ];

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
        <Link
          href="/studio?tool=chat"
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Go home"
          title="LiTTree Agent"
        >
          <Home size={20} />
        </Link>
        <Link href="/studio?tool=chat" className="font-black text-sm" style={{ color: T.headerColor }}>
          LiTTree OS
        </Link>
      </div>

      {/* Desktop navigation links */}
      <nav className="hidden lg:flex items-center gap-2">
        {mainLinks.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors hover:bg-white/5"
              style={{ color: T.textMuted }}
            >
              <Icon size={14} />
              {item.label}
            </Link>
          );
        })}

        {/* More dropdown */}
        <div className="relative" ref={moreRef}>
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-bold transition-colors hover:bg-white/5"
            style={{ color: T.textMuted }}
          >
            More
            <ChevronDown size={12} style={{ transform: moreOpen ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} />
          </button>
          {moreOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-xl border shadow-2xl z-50"
              style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "28" }}
            >
              {moreLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5"
                    style={{ color: T.textMuted }}
                  >
                    <Icon size={13} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

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
        <Link
          href="/settings"
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </Link>
        <NavAuth linkColor={T.accentColor} />
      </div>
    </header>
  );
}
