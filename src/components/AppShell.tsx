"use client";

/**
 * AppShell — the ONE canonical authenticated application shell.
 *
 * Top-bar navigation everywhere (product direction 2026-09-15):
 *   - One sticky glass top bar on all viewports: logo, primary nav,
 *     LiTT status, BITS balance, and the identity dock.
 *   - Mobile gets a second horizontally-scrollable nav strip under the
 *     bar. Studio keeps its own mobile chrome, so the strip is skipped
 *     there (the single-row bar with logo + account stays).
 *   - Shared navigation data from lib/navigation.ts (flag-gated).
 *
 * Public pages and Studio keep their own layouts (handled by LayoutShell).
 */

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  LogOut,
  UserCircle,
  Wallet as WalletIcon,
  Settings as SettingsIcon,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { useLittHealth } from "@/hooks/useLittHealth";
import {
  getVisibleNavSections,
  APP_NAV_BOTTOM,
  isAppNavActive,
  type NavItem,
} from "@/lib/navigation";
import { BrandLogo } from "@/components/branding/BrandLogo";

/* ─── Identity Dock ────────────────────────────────────────────────── */

/**
 * IdentityDock — the top-bar account/identity tray.
 *
 * Shows the Clerk avatar with an online dot. Clicking opens a dropdown
 * (below the bar, right-aligned) with Profile / Wallet / Settings /
 * Account / Sign out. Signed-out state shows a Sign in button.
 */
function IdentityDock() {
  const T = useTheme().resolvedColors;
  const { isSignedIn, isLoaded, signOut } = useClerkAuth();
  const { user } = useAppUser();
  const [plan, setPlan] = useState("Free");
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    let active = true;
    fetch(`/api/users/${user.id}/plan`)
      .then((r) => (r.ok ? r.json() : { plan: "free" }))
      .then((data) => { if (active && data.plan) setPlan(data.plan); })
      .catch(() => {});
    return () => { active = false; };
  }, [isSignedIn, user?.id]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (dockRef.current && !dockRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ── Signed-out state ──
  if (isLoaded && !isSignedIn) {
    return (
      <Link
        href="/sign-in"
        className="flex h-9 items-center rounded-xl border px-4 text-xs font-bold transition hover:bg-white/5"
        style={{ borderColor: `${T.accentColor}40`, color: T.accentColor }}
      >
        Sign in
      </Link>
    );
  }

  // ── Loading state ──
  if (!isLoaded || !user) {
    return (
      <div
        className="h-9 w-9 animate-pulse rounded-full"
        style={{ background: `${T.borderColor}20` }}
        role="status"
        aria-label="Loading account"
      />
    );
  }

  const displayName = user.firstName || user.fullName || user.username || "User";
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const role = plan === "owner" ? "Owner" : plan === "pro" ? "Pro" : "Free";
  const roleColor = role === "Owner" ? T.accentColor : role === "Pro" ? "#a78bfa" : T.textMuted;
  const avatarUrl = user.imageUrl;

  const menuItems = [
    { label: "Profile", href: "/profile", icon: UserCircle },
    { label: "Wallet", href: "/wallet", icon: WalletIcon },
    { label: "Settings", href: "/settings", icon: SettingsIcon },
  ];

  return (
    <div ref={dockRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative block h-9 w-9 overflow-hidden rounded-full border-2 transition hover:opacity-80"
        style={{ borderColor: open ? T.accentColor : `${T.accentColor}40` }}
        aria-label={`${displayName} — open account menu`}
        aria-expanded={open}
        title={displayName}
      >
        {avatarUrl ? (
          <Image src={avatarUrl} alt={displayName} fill sizes="36px" className="object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs font-bold" style={{ background: `${T.accentColor}20`, color: T.accentColor }}>
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        {/* Online status dot */}
        <span
          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2"
          style={{ background: "#22c55e", borderColor: T.bgColor }}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border p-1.5 shadow-2xl"
          style={{ borderColor: `${T.borderColor}30`, background: `${T.bgColor}f8`, backdropFilter: "blur(16px)" }}
        >
          <IdentityMenuHeader name={displayName} email={email} role={role} roleColor={roleColor} T={T} />
          <IdentityMenuItems items={menuItems} T={T} onClick={() => setOpen(false)} />
          <IdentityMenuDivider T={T} />
          <IdentityMenuSignOut onClick={() => { setOpen(false); void signOut(); }} />
        </div>
      )}
    </div>
  );
}

function IdentityMenuHeader({
  name, email, role, roleColor, T,
}: {
  name: string; email: string; role: string; roleColor: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="mb-1.5 rounded-lg px-2.5 py-2" style={{ background: `${T.borderColor}08` }}>
      <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>{name}</div>
      {email && (
        <div className="text-[10px] truncate" style={{ color: T.textMuted }}>{email}</div>
      )}
      <div className="mt-1 text-[9px] font-black uppercase tracking-wider" style={{ color: roleColor }}>
        {role}
      </div>
    </div>
  );
}

function IdentityMenuItems({
  items, T, onClick,
}: {
  items: { label: string; href: string; icon: typeof UserCircle }[];
  T: ReturnType<typeof useTheme>["resolvedColors"];
  onClick: () => void;
}) {
  return (
    <div className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onClick}
            className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-bold transition hover:bg-white/5"
            style={{ color: T.textMuted }}
          >
            <Icon size={14} className="shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function IdentityMenuDivider({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return <div className="my-1 h-px" style={{ background: `${T.borderColor}15` }} />;
}

function IdentityMenuSignOut({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-bold transition hover:bg-red-500/10"
      style={{ color: "#ef4444" }}
    >
      <LogOut size={14} className="shrink-0" />
      Sign out
    </button>
  );
}

/* ─── Nav item (top-bar pill) ──────────────────────────────────────── */

function TopNavItem({
  item,
  active,
  T,
}: {
  item: NavItem;
  active: boolean;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href ?? "#"}
      aria-current={active ? "page" : undefined}
      className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-bold transition-all"
      style={{
        background: active ? `${T.accentColor}14` : "transparent",
        color: active ? T.textColor : T.textMuted,
        boxShadow: active ? `inset 0 -2px 0 ${T.accentColor}` : "none",
      }}
    >
      <Icon
        size={16}
        className="shrink-0"
        style={{
          color: active ? T.accentColor : undefined,
          filter: active ? `drop-shadow(0 0 4px ${T.accentColor}40)` : undefined,
        }}
      />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

/* ─── Top Bar ──────────────────────────────────────────────────────── */

function TopBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const { balance } = useWallet();
  const littHealth = useLittHealth();

  // Studio manages its own mobile chrome (header, bottom nav, composer),
  // so the scrollable nav strip is skipped there — the single-row bar
  // (logo + status + account) still renders.
  const isStudio = pathname?.startsWith("/studio") ?? false;

  const checkActive = (href: string) => isAppNavActive(pathname, searchParams, href);
  const sections = getVisibleNavSections();

  return (
    <header
      className="sticky top-0 z-40 shrink-0"
      style={{
        background: `${T.bgColor}e6`,
        backdropFilter: "blur(14px)",
        borderBottom: `1px solid ${T.borderColor}20`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
      }}
    >
      {/* Main bar row */}
      <div className="flex h-14 items-center gap-2 px-3 md:gap-3 md:px-4">
        <BrandLogo href="/dashboard" size={30} showText />

        {/* Desktop nav — sections inline, separated by dividers */}
        <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="Primary">
          {sections.map((section, si) => (
            <div key={section.id} className="flex items-center gap-0.5">
              {si > 0 && (
                <span
                  className="mx-1.5 h-4 w-px"
                  style={{ background: `${T.borderColor}30` }}
                  aria-hidden
                />
              )}
              {section.items.map((item) => (
                <TopNavItem
                  key={item.label}
                  item={item}
                  active={checkActive(item.href ?? "")}
                  T={T}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="flex-1" />

        {/* LiTT health — pill on sm+, dot only on xs */}
        <div
          className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 sm:flex"
          style={{ borderColor: `${T.borderColor}20`, background: `${T.boxBg}50` }}
          title={`LiTT status: ${littHealth.label}`}
        >
          <span className="relative flex h-2 w-2">
            {littHealth.pulse && (
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                style={{ backgroundColor: littHealth.color }}
              />
            )}
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: littHealth.color }}
            />
          </span>
          <span
            className="hidden text-[9px] font-black uppercase tracking-wider md:inline"
            style={{ color: littHealth.color }}
          >
            {littHealth.label}
          </span>
        </div>

        {/* BITS — signed-in users */}
        {isSignedIn && (
          <span
            className="hidden text-[11px] font-bold sm:block"
            style={{ color: T.textMuted }}
            title="Your BITS balance"
          >
            {balance.toLocaleString()} <span style={{ color: T.accentColor }}>BITS</span>
          </span>
        )}

        {/* Wallet + Settings — desktop only (in the mobile strip / account menu otherwise) */}
        {isSignedIn && (
          <div className="hidden items-center gap-0.5 md:flex">
            {APP_NAV_BOTTOM.map((item) => {
              const Icon = item.icon;
              const active = checkActive(item.href ?? "");
              return (
                <Link
                  key={item.label}
                  href={item.href ?? "#"}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/5"
                  style={{
                    color: active ? T.accentColor : T.textMuted,
                    background: active ? `${T.accentColor}10` : "transparent",
                  }}
                >
                  <Icon size={18} />
                </Link>
              );
            })}
          </div>
        )}

        {/* Identity dock — avatar + account menu */}
        <IdentityDock />
      </div>

      {/* Mobile nav strip — horizontally scrollable, skipped on Studio */}
      {!isStudio && (
        <nav
          className="flex items-center gap-0.5 overflow-x-auto border-t px-2 py-1.5 md:hidden"
          style={{
            borderColor: `${T.borderColor}15`,
            scrollbarWidth: "none",
          }}
          aria-label="Primary"
        >
          {sections.map((section, si) => (
            <div key={section.id} className="flex items-center gap-0.5">
              {si > 0 && (
                <span
                  className="mx-1 h-4 w-px shrink-0"
                  style={{ background: `${T.borderColor}30` }}
                  aria-hidden
                />
              )}
              {section.items.map((item) => (
                <TopNavItem
                  key={item.label}
                  item={item}
                  active={checkActive(item.href ?? "")}
                  T={T}
                />
              ))}
            </div>
          ))}
          {isSignedIn && (
            <>
              <span
                className="mx-1 h-4 w-px shrink-0"
                style={{ background: `${T.borderColor}30` }}
                aria-hidden
              />
              {APP_NAV_BOTTOM.map((item) => (
                <TopNavItem
                  key={item.label}
                  item={item}
                  active={checkActive(item.href ?? "")}
                  T={T}
                />
              ))}
            </>
          )}
        </nav>
      )}
    </header>
  );
}

/* ─── Main AppShell Export ─────────────────────────────────────────── */

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Studio manages its own full-height chrome. Lock the shell to the
  // viewport height so Studio fills exactly the space below the top bar
  // (its root uses h-full); every other route scrolls the document.
  const isStudio = pathname?.startsWith("/studio") ?? false;

  return (
    <div className={isStudio ? "flex h-dvh flex-col overflow-hidden" : "flex min-h-dvh flex-col"}>
      {/* Top bar — wrapped in Suspense for useSearchParams SSG safety */}
      <Suspense fallback={<div className="h-14 shrink-0" />}>
        <TopBar />
      </Suspense>

      {/* Main content */}
      <main
        id="main-content"
        className={
          isStudio
            ? "flex min-h-0 flex-1 flex-col"
            : "flex w-full max-w-full min-w-0 flex-1 flex-col overflow-x-hidden"
        }
      >
        {children}
      </main>
    </div>
  );
}
