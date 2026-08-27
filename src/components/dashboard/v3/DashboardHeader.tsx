"use client";

/**
 * DashboardHeader — dashboard-specific top navigation bar.
 *
 * Renders within the AppShell content area (the sidebar is preserved).
 * Contains:
 *   - Brand + horizontal nav (Dashboard/Create/Work/Showcase/Explore)
 *   - Search bar with Ctrl+K shortcut
 *   - Real BITS balance (from WalletContext)
 *   - Wallet / Settings / Profile links
 *
 * All data comes from real authenticated state — no hardcoded values.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { useAppUser } from "@/hooks/useClerkAuth";
import { Terminal, Search, Settings, Wallet as WalletIcon } from "lucide-react";
import { useCallback } from "react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Create", href: "/studio?tool=image" },
  { label: "Work", href: "/projects" },
  { label: "Showcase", href: "/showcase" },
  { label: "Explore", href: "/discover" },
];

interface DashboardHeaderProps {
  onOpenCommandPalette: () => void;
}

export function DashboardHeader({ onOpenCommandPalette }: DashboardHeaderProps) {
  const pathname = usePathname();
  const { balance, displayBalance, billingExempt, isError, isLoading } = useWallet();
  const { user } = useAppUser();

  const handleSearchClick = useCallback(() => {
    onOpenCommandPalette();
  }, [onOpenCommandPalette]);

  const handleSearchKeydown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpenCommandPalette();
      }
    },
    [onOpenCommandPalette],
  );

  const balanceText = billingExempt
    ? displayBalance ?? "DEV ∞"
    : isError
      ? "—"
      : isLoading
        ? "…"
        : `${balance.toLocaleString()} BITS`;

  const displayName = user?.firstName || user?.username || "User";
  const avatarUrl = user?.imageUrl;

  return (
    <nav
      className="sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b px-4 backdrop-blur-xl md:px-6"
      style={{
        background: "rgba(10,10,12,0.8)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      {/* Left: Brand + Nav */}
      <div className="flex items-center gap-4 md:gap-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-lg font-bold tracking-tight"
          style={{ color: "#fafafa" }}
        >
          <Terminal size={20} style={{ color: "#a78bfa" }} />
          <span className="hidden sm:inline">LiTTree LabStudios</span>
        </Link>

        {/* Horizontal nav — hidden on mobile (sidebar/mobile bar handles it) */}
        <div className="hidden items-center gap-1 md:flex lg:gap-4">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href.split("?")[0]);
            return (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-md px-2.5 py-1 text-sm font-medium transition-colors lg:px-3"
                style={{
                  color: isActive ? "#a78bfa" : "rgba(250,250,250,0.6)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.color = "#a78bfa";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.color = "rgba(250,250,250,0.6)";
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Right: Search + BITS + Actions */}
      <div className="flex items-center gap-2 md:gap-4">
        {/* Search bar — hidden on small mobile */}
        <button
          onClick={handleSearchClick}
          onKeyDown={handleSearchKeydown}
          className="hidden items-center gap-2 rounded-md border px-3 py-1.5 transition-colors sm:flex"
          style={{
            background: "rgba(18,18,21,0.8)",
            borderColor: "rgba(255,255,255,0.06)",
            minWidth: 180,
          }}
          aria-label="Search (Ctrl+K)"
        >
          <Search size={14} style={{ color: "rgba(250,250,250,0.4)" }} />
          <span
            className="text-xs"
            style={{ color: "rgba(250,250,250,0.4)" }}
          >
            Search…
          </span>
          <kbd
            className="ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px]"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              color: "rgba(250,250,250,0.4)",
            }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Mobile search icon */}
        <button
          onClick={handleSearchClick}
          className="flex items-center justify-center rounded-md p-1.5 sm:hidden"
          aria-label="Search"
        >
          <Search size={18} style={{ color: "rgba(250,250,250,0.6)" }} />
        </button>

        {/* BITS balance */}
        <span
          className="font-mono text-xs font-medium"
          style={{
            color: billingExempt ? "#a78bfa" : isError ? "#71717a" : "#34d399",
          }}
        >
          {balanceText}
        </span>

        {/* Wallet */}
        <Link
          href="/wallet"
          className="hidden items-center rounded-md p-1.5 transition-colors md:flex"
          style={{ color: "rgba(250,250,250,0.6)" }}
          aria-label="Wallet"
          onMouseEnter={(e) => (e.currentTarget.style.color = "#a78bfa")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(250,250,250,0.6)")}
        >
          <WalletIcon size={18} />
        </Link>

        {/* Settings */}
        <Link
          href="/settings"
          className="hidden items-center rounded-md p-1.5 transition-colors md:flex"
          style={{ color: "rgba(250,250,250,0.6)" }}
          aria-label="Settings"
          onMouseEnter={(e) => (e.currentTarget.style.color = "#a78bfa")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(250,250,250,0.6)")}
        >
          <Settings size={18} />
        </Link>

        {/* Profile avatar */}
        <Link
          href="/profile"
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 transition-opacity hover:opacity-80"
          style={{ borderColor: "rgba(167,139,250,0.3)" }}
          aria-label={displayName}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span
              className="flex h-full w-full items-center justify-center text-xs font-bold"
              style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}
            >
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}
