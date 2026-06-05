"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import dynamic from "next/dynamic";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false }
);

const links = [
  { href: "/", label: "Home" },
  { href: "/builder", label: "Builder" },
  { href: "/marketplace", label: "Market" },
  { href: "/gallery", label: "Gallery" },
  { href: "/social", label: "Social" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

export default function Navbar() {
  const { theme, resolvedColors, setMode } = useTheme();

  return (
    <nav
      className="sticky top-0 z-50 border-b"
      style={{
        borderColor: resolvedColors.borderColor,
        backgroundColor: resolvedColors.boxBg,
      }}
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl">🚀</span>
            <span
              className="font-bold text-lg hidden sm:inline"
              style={{ color: resolvedColors.headerColor }}
            >
              LiTTree Lab
            </span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-1 sm:gap-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-2 py-1 text-xs sm:text-sm font-medium rounded hover:opacity-80 transition-opacity"
                style={{ color: resolvedColors.linkColor }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode(theme.mode === "dark" ? "light" : "dark")}
              className="px-2 py-1 text-xs font-bold border rounded hover:scale-105 transition-transform"
              style={{
                borderColor: resolvedColors.accentColor,
                color: resolvedColors.accentColor,
              }}
              title="Toggle dark/light"
            >
              {theme.mode === "dark" ? "☀️" : "🌙"}
            </button>
            <NavAuth linkColor={resolvedColors.linkColor} />
          </div>
        </div>
      </div>
    </nav>
  );
}
