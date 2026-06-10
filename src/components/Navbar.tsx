"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import dynamic from "next/dynamic";
import {
  Home, ShoppingBag, Sparkles,
  Settings, Sun, Moon, Zap,
  ChevronDown, X, Menu, Bell, Coins, User, Image
} from "lucide-react";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false }
);

/* ------------------------------------------------------------------ */
/*  Primary nav links — ALL surfaced, no hidden dropdown               */
/* ------------------------------------------------------------------ */
const navLinks = [
  { href: "/", label: "Home", icon: Home },
  { href: "/studio", label: "Studio", icon: Zap },
  { href: "/marketplace", label: "Market", icon: ShoppingBag },
  { href: "/generate", label: "Generate", icon: Image },
];

/* ------------------------------------------------------------------ */
/*  Utility items for mobile / user dropdown                           */
/* ------------------------------------------------------------------ */
const userLinks = [
  { href: "/profile", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/showcase", label: "Showcase", icon: Sparkles },
];

function useLocalStorageNumber(key: string, fallback: number) {
  const [val, setVal] = useState(fallback);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setVal(Number(raw));
    } catch {}
  }, [key]);
  return val;
}

export default function Navbar() {
  const { theme, resolvedColors, setMode } = useTheme();
  const { profile } = useProfile();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const litcoins = useLocalStorageNumber("litcoins", 500);

  /* Close dropdowns on outside click */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* Close mobile menu on route change */
  useEffect(() => {
    setMobileOpen(false);
    setUserOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      className="sticky top-0 z-50"
      style={{
        borderBottom: `1px solid ${resolvedColors.borderColor}25`,
        backgroundColor: resolvedColors.bgColor + "cc",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        boxShadow: `0 1px 0 ${resolvedColors.accentColor}10, 0 4px 20px rgba(0,0,0,0.3)`,
      }}
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg transition-transform duration-300 group-hover:scale-105" style={{ background: `linear-gradient(135deg, ${resolvedColors.accentColor}30, ${resolvedColors.headerColor}20)`, border: `1px solid ${resolvedColors.accentColor}40` }}>
              <Zap size={16} className="transition-all duration-300 group-hover:rotate-12" style={{ color: resolvedColors.accentColor }} />
            </div>
            <div className="hidden sm:flex flex-col leading-none">
              <span className="font-black text-[13px] tracking-tight" style={{ background: `linear-gradient(90deg, ${resolvedColors.headerColor}, ${resolvedColors.accentColor})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                LiTree Labs
              </span>
              <span className="text-[9px] font-bold tracking-widest uppercase opacity-50" style={{ color: resolvedColors.textMuted }}>AI Platform</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1 bg-opacity-40 px-1 py-1 rounded-xl" style={{ backgroundColor: resolvedColors.boxBg + "40", border: `1px solid ${resolvedColors.borderColor}20` }}>
            {navLinks.map((link) => {
              const active = isActive(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all duration-200"
                  style={{
                    color: active ? resolvedColors.bgColor : resolvedColors.textMuted,
                    backgroundColor: active ? resolvedColors.accentColor : "transparent",
                    boxShadow: active ? `0 0 12px ${resolvedColors.accentColor}50` : "none",
                  }}
                >
                  <Icon size={12} strokeWidth={active ? 2.5 : 2} />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* LitCoins wallet */}
            <span
              className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold"
              style={{
                backgroundColor: resolvedColors.accentColor + "15",
                color: resolvedColors.accentColor,
                border: `1px solid ${resolvedColors.accentColor}30`,
              }}
              title="Your LiTBit Coins balance"
            >
              <Coins size={10} /> ∞ FREE
            </span>

            {/* Notification bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="p-1.5 rounded-md transition-all duration-200 hover:scale-110 relative"
                style={{
                  border: `1px solid ${resolvedColors.accentColor}30`,
                  color: resolvedColors.accentColor,
                  backgroundColor: resolvedColors.accentColor + "08",
                }}
                title="Notifications"
              >
                <Bell size={14} />
                <span
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                  style={{ backgroundColor: resolvedColors.headerColor }}
                />
              </button>
              {notifOpen && (
                <div
                  className="absolute top-full right-0 mt-2 py-2 rounded-lg border min-w-[240px] z-50"
                  style={{
                    backgroundColor: resolvedColors.boxBg + "f0",
                    borderColor: resolvedColors.borderColor + "40",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: resolvedColors.textMuted }}>
                    Notifications
                  </div>
                  <div className="px-3 py-4 text-[11px] text-center" style={{ color: resolvedColors.textMuted }}>
                    No new notifications
                  </div>
                </div>
              )}
            </div>

            {/* Theme toggle */}
            <button
              onClick={() => setMode(theme.mode === "dark" ? "light" : "dark")}
              aria-label={theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="p-1.5 rounded-md transition-all duration-200 hover:scale-110"
              style={{
                border: `1px solid ${resolvedColors.accentColor}30`,
                color: resolvedColors.accentColor,
                backgroundColor: resolvedColors.accentColor + "08",
              }}
              title="Toggle dark/light"
            >
              {theme.mode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* User dropdown (profile/settings links) — desktop */}
            <div className="hidden md:block relative" ref={userRef}>
              <button
                onClick={() => setUserOpen((v) => !v)}
                aria-label="Navigation menu"
                aria-expanded={userOpen}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all hover:opacity-80"
                style={{
                  border: `1px solid ${resolvedColors.borderColor}30`,
                  backgroundColor: resolvedColors.boxBg + "60",
                }}
                title="Menu"
              >
                {profile?.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="Profile" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black" style={{ backgroundColor: resolvedColors.accentColor + "30", color: resolvedColors.accentColor }}>
                    {profile?.displayName?.[0]?.toUpperCase() || "U"}
                  </div>
                )}
                <ChevronDown size={10} style={{ color: resolvedColors.textMuted }} />
              </button>
              {userOpen && (
                <div
                  className="absolute top-full right-0 mt-2 py-1 rounded-lg border min-w-[160px] z-50"
                  style={{
                    backgroundColor: resolvedColors.boxBg + "f0",
                    borderColor: resolvedColors.borderColor + "40",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  {userLinks.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-bold transition-colors hover:opacity-80"
                        style={{ color: resolvedColors.textColor }}
                      >
                        <Icon size={13} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Auth — always visible: avatar+name when signed in, Sign In button when not */}
            <NavAuth linkColor={resolvedColors.accentColor} />

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              className="lg:hidden p-1.5 rounded-md"
              style={{ color: resolvedColors.linkColor }}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile full-screen overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 flex flex-col"
          style={{
            backgroundColor: resolvedColors.bgColor + "f0",
            backdropFilter: "blur(24px)",
            top: "48px",
          }}
        >
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-lg transition-all"
                  style={{
                    color: active ? resolvedColors.headerColor : resolvedColors.textColor,
                    backgroundColor: active ? resolvedColors.accentColor + "12" : "transparent",
                    borderLeft: active ? `3px solid ${resolvedColors.accentColor}` : "3px solid transparent",
                  }}
                >
                  <Icon size={18} />
                  {link.label}
                </Link>
              );
            })}

            <div className="border-t my-3" style={{ borderColor: resolvedColors.borderColor + "20" }} />

            {userLinks.map((link) => {
              const Icon = link.icon;
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-lg transition-all"
                  style={{
                    color: active ? resolvedColors.headerColor : resolvedColors.textColor,
                    backgroundColor: active ? resolvedColors.accentColor + "12" : "transparent",
                  }}
                >
                  <Icon size={18} />
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="px-4 py-4 border-t" style={{ borderColor: resolvedColors.borderColor + "20" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold" style={{ color: resolvedColors.textMuted }}>LiTBit Coins</span>
              <span className="text-xs font-bold" style={{ color: resolvedColors.accentColor }}>∞ FREE</span>
            </div>
            <NavAuth linkColor={resolvedColors.linkColor} />
          </div>
        </div>
      )}
    </nav>
  );
}
