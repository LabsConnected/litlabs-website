"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, Search, Settings } from "lucide-react";
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

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const visibleLinks = desktopLinks.filter(([, href]) => {
    if (href === "/games" && !isFeatureEnabled("retroGameRuntime")) return false;
    if (href === "/discover" && !isFeatureEnabled("communitySocial")) return false;
    return true;
  });

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
        <BrandLogo
          href="/dashboard"
          size={30}
          showText={false}
          className="lg:hidden"
        />
        <BrandLogo
          href="/dashboard"
          size={30}
          showText
          className="hidden lg:inline-flex"
        />
        <nav className="ml-2 flex items-center gap-0.5 lg:ml-4 lg:gap-1">
          {visibleLinks.map(([label, href]) => {
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
        <Link
          href="/settings"
          className="rounded-lg p-2 transition-colors hover:bg-white/5"
          style={{
            color: pathname?.startsWith("/settings") ? T.accentColor : T.textMuted,
            backgroundColor: pathname?.startsWith("/settings") ? `${T.accentColor}12` : "transparent",
          }}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </Link>
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
