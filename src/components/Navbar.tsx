"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import dynamic from "next/dynamic";
import {
  Home, ShoppingBag, Sparkles,
  Settings, Sun, Moon, Zap,
  ChevronDown, X, Menu, Bell, Coins, Bot, User
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
  { href: "/agents", label: "Agents", icon: Bot },
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
      className="sticky top-0 z-50 border-b"
      style={{
        borderColor: resolvedColors.borderColor + "30",
        backgroundColor: resolvedColors.bgColor + "b0",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-12">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <div className="relative">
              <Zap
                size={20}
                className="transition-all duration-300 group-hover:scale-110 group-hover:rotate-12"
                style={{ color: resolvedColors.accentColor }}
              />
              <div className="absolute inset-0 blur-md opacity-40" style={{ color: resolvedColors.accentColor }} />
            </div>
            <span className="font-black text-sm hidden sm:inline tracking-tight" style={{ color: resolvedColors.headerColor }}>
              LiTree Labs
            </span>
          </Link>

          {/* Desktop Nav — all pages surfaced */}
          <div className="hidden lg:flex items-center gap-0.5">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="relative flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-bold rounded-md transition-all duration-200 hover:opacity-80"
                  style={{ color: active ? resolvedColors.headerColor : resolvedColors.linkColor }}
                >
                  <Icon size={13} strokeWidth={active ? 2.5 : 2} />
                  <span>{link.label}</span>
                  {active && (
                    <span
                      className="absolute bottom-0 left-1.5 right-1.5 h-[2px] rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${resolvedColors.linkColor}, ${resolvedColors.headerColor})`,
                        boxShadow: `0 0 8px ${resolvedColors.accentColor}60`,
                      }}
                    />
                  )}
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
              title="Your LitCoins balance"
            >
              <Coins size={10} /> {litcoins.toLocaleString()}
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
                className="flex items-center gap-1 p-1 rounded-md transition-all hover:opacity-70"
                style={{
                  border: `1px solid ${resolvedColors.borderColor}40`,
                  backgroundColor: resolvedColors.boxBg + "60",
                }}
                title="Menu"
              >
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
              <span className="text-xs font-bold" style={{ color: resolvedColors.textMuted }}>LitCoins</span>
              <span className="text-xs font-bold" style={{ color: resolvedColors.accentColor }}>{litcoins.toLocaleString()}</span>
            </div>
            <NavAuth linkColor={resolvedColors.linkColor} />
          </div>
        </div>
      )}
    </nav>
  );
}
