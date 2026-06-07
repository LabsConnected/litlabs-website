"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import dynamic from "next/dynamic";
import {
  Home, Wrench, ShoppingBag, Image, Sparkles,
  User, Settings, Sun, Moon, Zap, Wand2, Film,
  ChevronDown, X, Menu
} from "lucide-react";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false }
);

/* ------------------------------------------------------------------ */
/*  Primary nav links (always visible)                                 */
/* ------------------------------------------------------------------ */
const primaryLinks = [
  { href: "/", label: "Home", icon: Home },
  { href: "/studio", label: "Studio", icon: Zap },
  { href: "/marketplace", label: "Market", icon: ShoppingBag },
];

/* ------------------------------------------------------------------ */
/*  "More" dropdown items                                              */
/* ------------------------------------------------------------------ */
const moreItems = [
  { href: "/showcase", label: "Showcase", icon: Sparkles },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Navbar() {
  const { theme, resolvedColors, setMode } = useTheme();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  /* Close dropdown on outside click */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* Close mobile menu on route change */
  useEffect(() => {
    setMobileOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const studioActive = pathname === "/studio" || pathname.startsWith("/studio");

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
              <div
                className="absolute inset-0 blur-md opacity-40"
                style={{ color: resolvedColors.accentColor }}
              />
            </div>
            <span
              className="font-black text-sm hidden sm:inline tracking-tight"
              style={{ color: resolvedColors.headerColor }}
            >
              LiTree Lab's
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-0.5">
            {primaryLinks.map((link) => {
              const active = link.href === "/studio" ? studioActive : isActive(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="relative flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md transition-all duration-200 hover:opacity-80"
                  style={{
                    color: active ? resolvedColors.headerColor : resolvedColors.linkColor,
                  }}
                >
                  <Icon size={14} strokeWidth={active ? 2.5 : 2} />
                  <span>{link.label}</span>
                  {active && (
                    <span
                      className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${resolvedColors.linkColor}, ${resolvedColors.headerColor})`,
                        boxShadow: `0 0 8px ${resolvedColors.accentColor}60`,
                      }}
                    />
                  )}
                </Link>
              );
            })}

            {/* More dropdown */}
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-md transition-all duration-200 hover:opacity-80"
                style={{ color: resolvedColors.linkColor }}
              >
                <span>More</span>
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`}
                />
              </button>

              {moreOpen && (
                <div
                  className="absolute top-full right-0 mt-1 py-1 rounded-lg border min-w-[160px] z-50"
                  style={{
                    backgroundColor: resolvedColors.boxBg + "f0",
                    borderColor: resolvedColors.borderColor + "40",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  {moreItems.map((item) => {
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
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* LiTBit mini badge */}
            <span
              className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold"
              style={{
                backgroundColor: resolvedColors.accentColor + "15",
                color: resolvedColors.accentColor,
                border: `1px solid ${resolvedColors.accentColor}30`,
              }}
            >
              <Zap size={10} /> LiTBit
            </span>

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

            <div className="hidden md:block">
              <NavAuth linkColor={resolvedColors.linkColor} />
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden p-1.5 rounded-md"
              style={{ color: resolvedColors.linkColor }}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="md:hidden border-t px-4 py-3 space-y-1"
          style={{
            borderColor: resolvedColors.borderColor + "30",
            backgroundColor: resolvedColors.boxBg + "f0",
            backdropFilter: "blur(16px)",
          }}
        >
          {[...primaryLinks, ...moreItems].map((link) => {
            const Icon = link.icon;
            const active = link.href === "/studio" ? studioActive : isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md"
                style={{
                  color: active ? resolvedColors.headerColor : resolvedColors.textColor,
                  backgroundColor: active ? resolvedColors.accentColor + "10" : "transparent",
                }}
              >
                <Icon size={16} />
                {link.label}
              </Link>
            );
          })}
          <div className="pt-2 border-t" style={{ borderColor: resolvedColors.borderColor + "20" }}>
            <div className="px-3 py-1">
              <NavAuth linkColor={resolvedColors.linkColor} />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
