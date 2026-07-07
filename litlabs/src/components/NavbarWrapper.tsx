"use client";

import { useState, useEffect } from "react";
import { Bell, Search, Settings, Home, Gamepad2, Store, Bot, User, Images } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";
import dynamic from "next/dynamic";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false },
);

const ClerkUserButton = dynamic(
  () => import("@clerk/nextjs").then((m) => ({ default: m.UserButton })),
  { ssr: false },
);

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
          href="/dashboard"
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Go home"
          title="Dashboard"
        >
          <Home size={20} />
        </Link>
        <Link href="/dashboard" className="font-black text-sm" style={{ color: T.headerColor }}>
          LiTTree OS
        </Link>
      </div>

      {/* Desktop navigation links */}
      <nav className="hidden lg:flex items-center gap-1">
        {[
          { href: "/studio?tool=chat", label: "LiTTree Agent", icon: Bot },
          { href: "/gallery", label: "Gallery", icon: Images },
          { href: "/marketplace", label: "Marketplace", icon: Store },
          { href: "/games/cloud", label: "Games", icon: Gamepad2 },
          { href: "/profile", label: "Profile", icon: User },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors hover:bg-white/5"
              style={{ color: T.textMuted }}
            >
              <Icon size={13} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-1">
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
        <div className="pl-1">
          <ClerkUserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: "w-7 h-7",
                userButtonPopoverCard: { zIndex: 9999 },
              },
            }}
          />
        </div>
        <NavAuth linkColor={T.accentColor} />
      </div>
    </header>
  );
}
