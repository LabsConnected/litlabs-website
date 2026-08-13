"use client";

/**
 * AppShell — the ONE canonical authenticated application shell.
 *
 * Replaces NavbarWrapper + MobileBottomNav with a unified system:
 *   - Desktop: glass sidebar (72px collapsed / 256px expanded)
 *   - Mobile: slide-out drawer + simplified bottom bar
 *   - Shared navigation data from lib/navigation.ts
 *   - Collapsed state persisted in localStorage
 *   - Owner/BITS status at bottom
 *   - LiTT Online indicator
 *   - Active route gets illuminated glass pill + vertical accent
 *
 * Public pages and Studio keep their own layouts (handled by LayoutShell).
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Bell,
  Search,
  Menu,
  Plus,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { useLittHealth } from "@/hooks/useLittHealth";
import {
  APP_NAV_SECTIONS,
  APP_NAV_BOTTOM,
  APP_MOBILE_BOTTOM_ITEMS,
  isAppNavActive,
  COLLAPSED_KEY,
  type NavItem,
} from "@/lib/navigation";
import { BrandLogo } from "@/components/branding/BrandLogo";

/* ─── Desktop Sidebar ──────────────────────────────────────────────── */

function DesktopSidebar({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { balance } = useWallet();
  const { isSignedIn } = useClerkAuth();
  const { user } = useAppUser();
  const littHealth = useLittHealth();
  const [plan, setPlan] = useState("Free");

  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    let active = true;
    fetch(`/api/users/${user.id}/plan`)
      .then((r) => (r.ok ? r.json() : { plan: "free" }))
      .then((data) => { if (active && data.plan) setPlan(data.plan); })
      .catch(() => {});
    return () => { active = false; };
  }, [isSignedIn, user?.id]);

  const checkActive = useCallback(
    (href: string) => isAppNavActive(pathname, searchParams, href),
    [pathname, searchParams],
  );

  return (
    <aside
      className={`sticky top-0 z-20 hidden h-screen shrink-0 flex-col border-r transition-[width] duration-200 ease-out md:flex ${
        collapsed ? "w-[72px]" : "w-[256px]"
      }`}
      style={{
        background: `linear-gradient(180deg, ${T.bgColor}f2 0%, #07060d 50%, ${T.bgColor}f2 100%)`,
        borderColor: `${T.borderColor}20`,
        boxShadow: "16px 0 48px rgba(0,0,0,0.25)",
      }}
    >
      {/* Header — logo + collapse toggle */}
      <header
        className="flex h-14 shrink-0 items-center border-b px-3"
        style={{ borderColor: `${T.borderColor}15` }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <BrandLogo href="/dashboard" size={28} showText={!collapsed} />
        </div>
        <button
          onClick={onToggleCollapse}
          className="grid h-8 w-8 place-items-center rounded-lg transition hover:bg-white/5"
          style={{ color: T.textMuted }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </header>

      {/* Navigation sections */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-2 py-3">
        {APP_NAV_SECTIONS.map((section) => (
          <div key={section.id} className="mb-4">
            {/* Section label */}
            <div
              className={`mb-1.5 text-[8px] font-black uppercase tracking-[.2em] ${
                collapsed ? "text-center" : "px-2.5"
              }`}
              style={{ color: "rgba(255,255,255,0.28)" }}
            >
              {collapsed ? "•" : section.label}
            </div>
            {/* Items */}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <DesktopNavItem
                  key={item.label}
                  item={item}
                  active={checkActive(item.href ?? "")}
                  collapsed={collapsed}
                  T={T}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom — status + utility items + collapse */}
      <div className="shrink-0 border-t px-2 py-2.5" style={{ borderColor: `${T.borderColor}15` }}>
        {/* LiTT health + BITS — truthful status derived from real health check */}
        <div
          className={`mb-2 ${collapsed ? "flex flex-col items-center gap-1" : "flex items-center justify-between rounded-lg border px-2.5 py-2"}`}
          style={!collapsed ? { borderColor: `${T.borderColor}15`, background: `${T.boxBg}50` } : undefined}
        >
          {/* Health indicator — derived from /api/health */}
          <div className={`flex items-center gap-1.5 ${collapsed ? "justify-center" : ""}`}>
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
            {!collapsed && (
              <span
                className="text-[9px] font-black uppercase tracking-wider"
                style={{ color: littHealth.color }}
              >
                {littHealth.label}
              </span>
            )}
          </div>
          {/* BITS */}
          {!collapsed && (
            <span className="text-[10px] font-bold" style={{ color: T.textMuted }}>
              {balance.toLocaleString()} <span style={{ color: T.accentColor }}>BITS</span>
            </span>
          )}
        </div>

        {/* Utility items */}
        <div className="space-y-0.5">
          {APP_NAV_BOTTOM.map((item) => (
            <DesktopNavItem
              key={item.label}
              item={item}
              active={checkActive(item.href ?? "")}
              collapsed={collapsed}
              T={T}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

/* ─── Desktop Nav Item ─────────────────────────────────────────────── */

function DesktopNavItem({
  item,
  active,
  collapsed,
  T,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href ?? "#"}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center rounded-xl border transition-all duration-200 ${
        collapsed ? "mx-auto h-10 w-10 justify-center" : "h-10 gap-3 px-3"
      }`}
      style={{
        background: active
          ? `linear-gradient(90deg, ${T.accentColor}1a, ${T.accentColor}06, transparent)`
          : "transparent",
        borderColor: active ? `${T.accentColor}30` : "transparent",
        color: active ? T.textColor : T.textMuted,
        boxShadow: active ? `inset 2px 0 0 ${T.accentColor}` : "none",
      }}
    >
      <Icon
        size={17}
        style={{
          color: active ? T.accentColor : undefined,
          filter: active ? `drop-shadow(0 0 4px ${T.accentColor}40)` : undefined,
        }}
        className="shrink-0"
      />
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{item.label}</span>
      )}
      {/* Tooltip when collapsed */}
      {collapsed && (
        <span
          className="pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-bold opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={{
            borderColor: T.borderColor,
            background: T.bgColor,
            color: T.textColor,
          }}
        >
          {item.label}
        </span>
      )}
    </Link>
  );
}

/* ─── Mobile Drawer ────────────────────────────────────────────────── */

function MobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { balance } = useWallet();

  const checkActive = useCallback(
    (href: string) => isAppNavActive(pathname, searchParams, href),
    [pathname, searchParams],
  );

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r"
        style={{
          background: `linear-gradient(180deg, ${T.bgColor}f8, #07060d 60%, ${T.bgColor}f8)`,
          borderColor: `${T.borderColor}30`,
        }}
      >
        {/* Header */}
        <div
          className="flex h-14 shrink-0 items-center justify-between border-b px-4"
          style={{ borderColor: `${T.borderColor}20` }}
        >
          <BrandLogo href="/dashboard" size={32} showText />
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/5"
            style={{ color: T.textMuted }}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav sections */}
        <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
          {APP_NAV_SECTIONS.map((section) => (
            <div key={section.id} className="mb-5">
              <div
                className="mb-2 px-2 text-[8px] font-black uppercase tracking-[.2em]"
                style={{ color: "rgba(255,255,255,0.28)" }}
              >
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = checkActive(item.href ?? "");
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href ?? "#"}
                      onClick={onClose}
                      className="flex h-11 items-center gap-3 rounded-xl border px-3 transition-all"
                      style={{
                        background: active
                          ? `linear-gradient(90deg, ${T.accentColor}1a, transparent)`
                          : "transparent",
                        borderColor: active ? `${T.accentColor}30` : "transparent",
                        color: active ? T.textColor : T.textMuted,
                        boxShadow: active ? `inset 2px 0 0 ${T.accentColor}` : "none",
                      }}
                    >
                      <Icon size={18} style={{ color: active ? T.accentColor : undefined }} />
                      <span className="text-sm font-bold">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Bottom items */}
          <div className="mb-3">
            <div
              className="mb-2 px-2 text-[8px] font-black uppercase tracking-[.2em]"
              style={{ color: "rgba(255,255,255,0.28)" }}
            >
              Account
            </div>
            <div className="space-y-0.5">
              {APP_NAV_BOTTOM.map((item) => {
                const active = checkActive(item.href ?? "");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href ?? "#"}
                    onClick={onClose}
                    className="flex h-11 items-center gap-3 rounded-xl border px-3 transition-all"
                    style={{
                      background: active
                        ? `linear-gradient(90deg, ${T.accentColor}1a, transparent)`
                        : "transparent",
                      borderColor: active ? `${T.accentColor}30` : "transparent",
                      color: active ? T.textColor : T.textMuted,
                      boxShadow: active ? `inset 2px 0 0 ${T.accentColor}` : "none",
                    }}
                  >
                    <Icon size={18} style={{ color: active ? T.accentColor : undefined }} />
                    <span className="text-sm font-bold">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Status footer */}
        <div
          className="shrink-0 border-t px-4 py-3"
          style={{ borderColor: `${T.borderColor}15` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">LiTT Online</span>
            </div>
            <span className="text-[11px] font-bold" style={{ color: T.textMuted }}>
              {balance.toLocaleString()} <span style={{ color: T.accentColor }}>BITS</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Mobile Bottom Bar ────────────────────────────────────────────── */

function MobileBottomBar() {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  const items = APP_MOBILE_BOTTOM_ITEMS.slice(0, 2);
  const rightItems = APP_MOBILE_BOTTOM_ITEMS.slice(2);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#080910]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <div className="relative grid h-16 grid-cols-5 items-center">
        {/* Left items */}
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className="relative flex min-h-11 flex-col items-center justify-center gap-0.5 transition-all"
              style={{ color: active ? T.accentColor : T.textMuted }}
            >
              {active && (
                <span
                  className="absolute inset-x-3 top-0 h-0.75 rounded-full"
                  style={{ backgroundColor: T.accentColor, boxShadow: `0 0 8px ${T.accentColor}80` }}
                />
              )}
              <Icon size={20} style={active ? { filter: `drop-shadow(0 0 4px ${T.accentColor}60)` } : undefined} />
              <span className="text-[9px] font-black">{item.label}</span>
            </Link>
          );
        })}

        {/* Center Create button */}
        <Link
          href="/studio?tool=chat"
          className="relative flex flex-col items-center justify-center"
          aria-label="Create"
        >
          <span
            className="grid h-12 w-12 place-items-center rounded-2xl border-2 transition-all active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor}, ${T.accentColor}cc)`,
              borderColor: `${T.accentColor}60`,
              boxShadow: `0 4px 20px ${T.accentColor}40, 0 0 12px ${T.accentColor}30`,
            }}
          >
            <Plus size={24} className="text-white" />
          </span>
        </Link>

        {/* Right items */}
        {rightItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className="relative flex min-h-11 flex-col items-center justify-center gap-0.5 transition-all"
              style={{ color: active ? T.accentColor : T.textMuted }}
            >
              {active && (
                <span
                  className="absolute inset-x-3 top-0 h-0.75 rounded-full"
                  style={{ backgroundColor: T.accentColor, boxShadow: `0 0 8px ${T.accentColor}80` }}
                />
              )}
              <Icon size={20} style={active ? { filter: `drop-shadow(0 0 4px ${T.accentColor}60)` } : undefined} />
              <span className="text-[9px] font-black">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ─── Mobile Top Bar (hamburger + logo) ────────────────────────────── */

function MobileTopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { resolvedColors: T } = useTheme();
  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 md:hidden"
      style={{
        backgroundColor: `${T.bgColor}e6`,
        borderColor: `${T.borderColor}20`,
        backdropFilter: "blur(14px)",
      }}
    >
      <button
        onClick={onMenuClick}
        className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/5"
        style={{ color: T.textMuted }}
        aria-label="Open menu"
      >
        <Menu size={22} />
      </button>
      <BrandLogo href="/dashboard" size={28} showText />
      <Link
        href="/settings"
        className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/5"
        style={{ color: T.textMuted }}
        aria-label="Settings"
      >
        <Search size={20} />
      </Link>
    </header>
  );
}

/* ─── Main AppShell Export ─────────────────────────────────────────── */

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Load collapsed state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  // Close mobile drawer on route change
  const pathname = usePathname();
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Studio manages its own full-height chrome (header, mobile bottom nav,
  // composer). The shared sidebar still renders on desktop, but we suppress
  // AppShell's mobile top bar, mobile bottom bar, and main bottom padding
  // to avoid double chrome on mobile.
  const isStudio = pathname?.startsWith("/studio") ?? false;

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — wrapped in Suspense for useSearchParams SSG safety */}
      <Suspense fallback={<div className="hidden md:block" style={{ width: collapsed ? 72 : 256 }} />}>
        <DesktopSidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </Suspense>

      {/* Mobile drawer (conditional) — wrapped in Suspense for useSearchParams SSG safety.
          Skipped for Studio (Studio has its own mobile nav with a Home link). */}
      {!isStudio && (
        <Suspense fallback={null}>
          <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
        </Suspense>
      )}

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — skipped for Studio (Studio has its own header) */}
        {!isStudio && <MobileTopBar onMenuClick={() => setMobileOpen(true)} />}

        {/* Main content.
            Studio is full-height (h-dvh) and manages its own mobile bottom nav,
            so we skip the mobile bottom padding that reserves space for AppShell's
            mobile bottom bar. */}
        <main
          id="main-content"
          className={`flex-1 w-full max-w-full min-w-0 overflow-x-hidden ${
            isStudio ? "" : "pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-0"
          }`}
        >
          {children}
        </main>

        {/* Mobile bottom bar — skipped for Studio (Studio has its own MobileCommandNav) */}
        {!isStudio && <MobileBottomBar />}
      </div>
    </div>
  );
}
