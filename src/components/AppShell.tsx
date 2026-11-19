"use client";

/**
 * AppShell — the ONE canonical authenticated application shell.
 *
 * Top-bar navigation everywhere (product direction 2026-09-15):
 *   - One sticky glass top bar on all viewports: logo, primary nav,
 *     LiTT status, LiTTBits balance, and the identity dock.
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
  Bell,
  LogOut,
  Settings as SettingsIcon,
  UserCircle,
  Wallet as WalletIcon,
} from "lucide-react";
import { OwnerTestModeIndicator } from "@/components/OwnerTestModeIndicator";
import { useTheme, resolveEffectiveMode } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { useLittHealth } from "@/hooks/useLittHealth";
import { planDisplayLabel } from "@/lib/plan-label";
import {
  getVisibleMainNav,
  withActiveProjectContext,
  APP_NAV_SECONDARY,
  isAppNavActive,
  type NavItem,
} from "@/lib/navigation";
import { BrandLogo } from "@/components/branding/BrandLogo";

type ResolvedColors = ReturnType<typeof useTheme>["resolvedColors"];

/**
 * Studio design palette for the top bar — the `.studio-shell` token
 * values from globals.css, carried explicitly.
 *
 * The Studio page's default presentation is the approved light design
 * (globals.css `.studio-shell` scope). This bar renders OUTSIDE that
 * scope, so under a dark account theme it painted black over the light
 * Studio (wave-3 Finding 1, Larry's screenshot 2026-11-10). Portaled
 * Studio menus solve the identical problem the identical way — the
 * light palette is carried explicitly (surface + text tokens). Only
 * Studio routes take this palette, and only while the effective theme
 * mode is LIGHT: since 2026-11-14 the Studio itself follows the
 * theme in Dark mode (the globals.css STUDIO DARK RE-SCOPE), so in
 * Dark the bar follows the active theme like every other route —
 * carrying the light palette there repainted the white-bar patchwork
 * Larry reported. The values are pinned to the CSS tokens by
 * AppShell.topbar.test.ts so the two can never drift apart silently.
 */
export const STUDIO_TOP_BAR_COLORS: Partial<ResolvedColors> = {
  bgColor: "#ffffff", // --studio-surface
  boxBg: "#ffffff", // --studio-elevated
  borderColor: "#86ac72", // --studio-border
  textColor: "#0e1510", // --text-primary
  textMuted: "#52684f", // --text-muted
  linkColor: "#177a36", // --color-accent
  headerColor: "#0e1510",
  accentColor: "#177a36", // --color-accent
};

export function topBarColorsFor(
  resolvedColors: ResolvedColors,
  isStudio: boolean,
  effectiveDark = false,
): ResolvedColors {
  return isStudio && !effectiveDark
    ? { ...resolvedColors, ...STUDIO_TOP_BAR_COLORS }
    : resolvedColors;
}

/** Live OS color-scheme, mirroring ThemeProvider's own listener, so
 *  "system" mode resolves the same way here as in the theme. */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

/* ─── Identity Dock ────────────────────────────────────────────────── */

/**
 * IdentityDock — the top-bar account/identity tray.
 *
 * Shows the Clerk avatar with an online dot. Clicking opens a dropdown
 * (below the bar, right-aligned) with Profile / Wallet / Settings /
 * Account / Sign out. Signed-out state shows a Sign in button.
 */
function IdentityDock({ T: TProp }: { T?: ResolvedColors }) {
  const themeColors = useTheme().resolvedColors;
  // TopBar passes the route-effective colors (Studio palette on Studio
  // routes) so the account menu matches the bar it drops from.
  const T = TProp ?? themeColors;
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
  // Every real plan ID gets its own honest label — a paying plan must
  // never render as "Free" (the API returns e.g. "pro_builder_beta").
  const role = planDisplayLabel(plan);
  const roleColor =
    role === "Owner" ? T.accentColor : role === "Free" ? T.textMuted : "#a78bfa";
  const avatarUrl = user.imageUrl;

  // Settings lives HERE, in the account menu (Studio Finish Spec,
  // Larry 2026-11-14 — supersedes the same-day board-only cleanup that
  // kept it in the primary nav): it is out of the top navigation and
  // reached from this menu on desktop and the More menu on the phone.
  const menuItems = [
    { label: "Profile", href: "/profile", icon: UserCircle },
    { label: "Wallet", href: "/wallet", icon: WalletIcon },
    { label: "Settings", href: "/settings", icon: SettingsIcon },
  ];
  // Secondary surfaces (Library, Developer Tools) — canonical nav data.
  const secondaryItems = APP_NAV_SECONDARY.flatMap((s) => s.items).filter(
    (i): i is NavItem & { href: string } => typeof i.href === "string",
  );

  return (
    <div ref={dockRef} className="relative">
      <button
        type="button"
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
          <IdentityMenuItems items={secondaryItems} T={T} onClick={() => setOpen(false)} />
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
      type="button"
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
  if (!item.href) return null;
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
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

/* ─── Notifications bell ─────────────────────────────────────────────
 * Lives in the TOP ROW beside the LiTT status (Larry, board-only
 * cleanup 2026-11-14) — it moved up from the Studio header, which no
 * longer carries its own bell or Owner badge. Polls the same
 * /api/notifications/count endpoint the header used (truthful; falls
 * back to no badge on error). */
function NotificationsBell({ T }: { T: ResolvedColors }) {
  const [notifCount, setNotifCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchNotifs = async () => {
      try {
        const res = await fetch("/api/notifications/count", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setNotifCount(typeof data.count === "number" ? data.count : null);
      } catch {
        if (!cancelled) setNotifCount(null);
      }
    };
    void fetchNotifs();
    const id = window.setInterval(fetchNotifs, 45_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  return (
    <Link
      href="/studio"
      className="relative hidden min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition-all hover:bg-black/5 sm:grid"
      style={{ color: T.textMuted }}
      aria-label={`Notifications${notifCount ? ` (${notifCount} unread)` : ""}`}
      title="Notifications"
      data-testid="topbar-notifications-bell"
    >
      <Bell size={15} />
      {notifCount ? (
        <span
          className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full px-1 text-[8px] font-black"
          style={{ backgroundColor: "#ef4444", color: "#fff" }}
        >
          {notifCount > 99 ? "99+" : notifCount}
        </span>
      ) : null}
    </Link>
  );
}

function TopBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors, theme } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const { balance, displayBalance, isLoading: walletLoading, isError: walletError } = useWallet();
  const littHealth = useLittHealth();
  const systemPrefersDark = useSystemPrefersDark();

  // Studio manages its own mobile chrome (header, bottom nav, composer),
  // so the scrollable nav strip is skipped there — the single-row bar
  // (logo + status + account) still renders.
  const isStudio = pathname?.startsWith("/studio") ?? false;
  // On Studio routes the bar wears the Studio design (see
  // STUDIO_TOP_BAR_COLORS) while the effective mode is light; in Dark
  // the Studio follows the theme, so the bar does too.
  const effectiveDark = resolveEffectiveMode(theme.mode, systemPrefersDark) === "dark";
  const T = topBarColorsFor(resolvedColors, isStudio, effectiveDark);

  const checkActive = (href?: string) => isAppNavActive(pathname, searchParams, href);
  // Studio destinations in the top bar carry the active project
  // (?project=) from the current URL — without this, navigating to
  // Assets/Agents/Missions from inside a project dropped the param and
  // Studio re-resolved to a different project (audit ART-20261111-082).
  const mainItems = withActiveProjectContext(
    getVisibleMainNav(),
    searchParams?.get("project"),
  );
  return (
    <header
      // Studio owns a viewport-locked, overflow-hidden layout. A sticky
      // top bar inside that scroll context can retain a clipped offset after
      // navigation/refresh, hiding the top of the global nav. Keep it in the
      // normal flex flow there; other app routes still benefit from stickiness.
      className={`${isStudio ? "relative" : "sticky top-0"} z-40 shrink-0`}
      style={{
        background: `${T.bgColor}e6`,
        backdropFilter: "blur(14px)",
        borderBottom: `1px solid ${T.borderColor}20`,
        // The Studio header's own soft green shadow on Studio routes;
        // the deep neutral shadow belongs to the dark themes.
        boxShadow: isStudio ? "0 4px 20px rgba(14,60,26,0.08)" : "0 8px 32px rgba(0,0,0,0.25)",
      }}
    >
      {/* Main bar row — Studio routes run one step denser (h-12), and
          the wide brand mark sits on a light chip there: the asset is
          dark lettering on white, so the chip keeps it reading as
          deliberately placed — on the light Studio bar and on dark
          bars alike — at a legible size. */}
      <div className={`flex ${isStudio ? "h-12" : "h-14"} items-center gap-2 px-3 md:gap-3 md:px-4`}>
        <BrandLogo
          href="/studio"
          size={isStudio ? 34 : 30}
          showText={false}
          variant="full"
          className="rounded-lg bg-white px-1.5 py-1 shadow-sm ring-1 ring-black/15"
        />

        {/* Desktop nav — canonical main items, all visible (the More
            overflow menu was emptied and removed, Larry 2026-11-16) */}
        <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="Primary">
          {mainItems.map((item) => (
            <TopNavItem
              key={item.label}
              item={item}
              active={checkActive(item.href)}
              T={T}
            />
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

        {/* LiTTBits — signed-in users. Never flash "0" while loading. */}
        {isSignedIn && (
          <span
            className="hidden text-[11px] font-bold sm:block"
            style={{ color: T.textMuted }}
            title="Your LiTTBits balance"
          >
            {walletLoading ? (
              <span
                className="inline-block h-3 w-14 animate-pulse rounded align-middle"
                style={{ background: isStudio ? "rgba(14,60,26,0.08)" : "rgba(255,255,255,0.08)" }}
                aria-label="Loading balance"
              />
            ) : walletError ? (
              <>-- <span style={{ color: T.accentColor }}>LiTTBits</span></>
            ) : (
              <>{displayBalance ?? balance.toLocaleString()} <span style={{ color: T.accentColor }}>LiTTBits</span></>
            )}
          </span>
        )}

        {/* Notifications + Owner — the top-row cluster beside LiTT
            status (moved up from the Studio header, 2026-11-14). The
            Owner indicator self-hides for non-owners. */}
        <NotificationsBell T={T} />
        <OwnerTestModeIndicator placement="inline" />

        {/* Identity dock — avatar + account menu */}
        <IdentityDock T={T} />
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
          {mainItems.map((item) => (
            <TopNavItem
              key={item.label}
              item={item}
              active={checkActive(item.href)}
              T={T}
            />
          ))}
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
      {/* Global LiTT floating entry removed app-wide (Larry, 2026-11-13):
          entry point only — the GlobalLittProvider, routes, and backend
          are untouched; Studio chat is the operator surface now. */}

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
