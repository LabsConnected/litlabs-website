"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, Search, Settings, Menu, X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { usePathname } from "next/navigation";

import { isFeatureEnabled } from "@/config/feature-flags";
import { BrandLogo } from "@/components/branding/BrandLogo";

const desktopLinks = [
  ["Dashboard", "/dashboard"],
  ["Studio", "/studio"],
  ["Gallery", "/gallery"],
  ["Games", "/games"],
  ["Discover", "/discover"],
  ["Marketplace", "/marketplace"],
  ["Pricing", "/pricing"],
] as const;

export default function NavbarWrapper() {
  const { resolvedColors: T } = useTheme();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [mobileOpen]);

  const visibleLinks = desktopLinks.filter(([, href]) => {
    if (href === "/games" && !isFeatureEnabled("retroGameRuntime")) return false;
    if (href === "/discover" && !isFeatureEnabled("communitySocial")) return false;
    return true;
  });

  const headerStyle = {
    backgroundColor: `${T.bgColor}${scrolled ? "f2" : "e6"}`,
    borderColor: `${T.borderColor}20`,
    backdropFilter: "blur(14px)" as const,
  };

  return (
    <>
      <header
        className="sticky top-0 z-30 flex h-16 items-center justify-between border-b px-4 transition-colors md:px-6"
        style={headerStyle}
      >
        {/* Left: hamburger + logo + desktop nav */}
        <div className="flex min-w-0 items-center gap-3">
          {/* Mobile hamburger */}
          <button
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors hover:bg-white/5 md:hidden"
            style={{ color: T.textMuted }}
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={22} />
          </button>

          {/* Logo — single instance, text hidden on mobile/tablet via CSS */}
          <BrandLogo
            href="/dashboard"
            size={38}
            showText
            className="[&>span]:hidden lg:[&>span]:inline"
          />

          {/* Desktop nav links — visible on md+ */}
          <nav className="ml-2 hidden items-center gap-0.5 md:ml-4 md:gap-1 md:flex">
            {visibleLinks.map(([label, href]) => {
              const active = pathname === href || pathname?.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-lg px-2.5 py-2 text-[11px] font-bold transition-colors hover:bg-white/5 lg:px-3 lg:text-xs ${
                    label === "Marketplace" ? "hidden lg:block" : ""
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

        {/* Right: only settings on mobile, search+bell+settings on desktop */}
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-white/5"
            style={{
              color: pathname?.startsWith("/settings") ? T.accentColor : T.textMuted,
              backgroundColor: pathname?.startsWith("/settings") ? `${T.accentColor}12` : "transparent",
            }}
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={20} />
          </Link>
          <button
            className="hidden h-10 w-10 place-items-center rounded-lg hover:bg-white/5 transition-colors md:grid"
            style={{ color: T.textMuted }}
            aria-label="Search"
          >
            <Search size={20} />
          </button>
          <button
            className="hidden h-10 w-10 place-items-center rounded-lg hover:bg-white/5 transition-colors md:grid"
            style={{ color: T.textMuted }}
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />

          {/* Drawer */}
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r"
            style={{
              backgroundColor: T.bgColor,
              borderColor: `${T.borderColor}40`,
            }}
          >
            {/* Drawer header */}
            <div
              className="flex h-14 shrink-0 items-center justify-between border-b px-4"
              style={{ borderColor: `${T.borderColor}30` }}
            >
              <BrandLogo href="/dashboard" size={38} showText />
              <button
                className="grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-white/5"
                style={{ color: T.textMuted }}
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            {/* Drawer nav links */}
            <nav className="flex-1 overflow-y-auto p-3">
              {visibleLinks.map(([label, href]) => {
                const active = pathname === href || pathname?.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="mb-1 flex items-center rounded-xl px-4 py-3 text-sm font-bold transition-colors hover:bg-white/5"
                    style={{
                      color: active ? T.accentColor : T.textColor,
                      backgroundColor: active ? `${T.accentColor}12` : "transparent",
                    }}
                  >
                    {label}
                  </Link>
                );
              })}

              {/* Extra links that are in the bottom nav but not the top nav */}
              <Link
                href="/settings"
                className="mb-1 flex items-center rounded-xl px-4 py-3 text-sm font-bold transition-colors hover:bg-white/5"
                style={{
                  color: pathname?.startsWith("/settings") ? T.accentColor : T.textColor,
                  backgroundColor: pathname?.startsWith("/settings") ? `${T.accentColor}12` : "transparent",
                }}
              >
                Settings
              </Link>
              <Link
                href="/profile"
                className="mb-1 flex items-center rounded-xl px-4 py-3 text-sm font-bold transition-colors hover:bg-white/5"
                style={{
                  color: pathname?.startsWith("/profile") ? T.accentColor : T.textColor,
                  backgroundColor: pathname?.startsWith("/profile") ? `${T.accentColor}12` : "transparent",
                }}
              >
                Profile
              </Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
