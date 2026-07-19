"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search, Zap, Coins, Gamepad2, Users, Settings, Store } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";

const desktopLinks = [
  ["Dashboard", "/dashboard"],
  ["Studio", "/studio"],
  ["Agents", "/agents"],
  ["Gallery", "/gallery"],
  ["Games", "/games"],
  ["Social", "/social"],
  ["Marketplace", "/marketplace"],
  ["Settings", "/settings"],
] as const;

export default function NavbarWrapper() {
  const { resolvedColors: T } = useTheme();
  const pathname = usePathname();
  const { balance, isLoading } = useWallet();
  const { isLoaded, isSignedIn } = useClerkAuth();
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
          {desktopLinks.map(([label, href]) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5"
                style={{
                  color: active ? T.accentColor : T.textMuted,
                }}
              >
                {label === "Games" && <Gamepad2 size={12} />}
                {label === "Social" && <Users size={12} />}
                {label === "Marketplace" && <Store size={12} />}
                {label === "Settings" && <Settings size={12} />}
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        {/* LitCoins wallet badge */}
        {isLoaded && isSignedIn && (
          <Link
            href="/wallet"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-colors hover:bg-white/5"
            style={{
              backgroundColor: T.accentColor + "15",
              color: T.accentColor,
              border: `1px solid ${T.accentColor}30`,
            }}
            title="Your LiTBit Coins balance"
          >
            <Coins size={12} />
            {isLoading ? "ΓÇö" : balance.toLocaleString()}
          </Link>
        )}
        <button
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Search"
        >
          <Search size={18} />
        </button>
        <Link
          href="/wallet"
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: T.textMuted }}
          aria-label="Wallet"
        >
          <Coins size={18} />
        </Link>
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
