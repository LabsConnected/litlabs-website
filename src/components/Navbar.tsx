"use client";

interface Notification {
  id: string;
  read_at?: string | null;
  created_at?: string;
  users?: { name?: string } | null;
  content?: string;
  [key: string]: unknown;
}

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { isFeatureEnabled } from "@/config/feature-flags";
import { BrandLogo } from "@/components/branding/BrandLogo";
import dynamic from "next/dynamic";
import {
  Home,
  ShoppingBag,
  Sparkles,
  Settings,
  Sun,
  Moon,
  X,
  Menu,
  Bell,
  Coins,
  User,
  Wand2,
  Bot,
  BrainCircuit,
  Gamepad2,
  MessageCircle,
} from "lucide-react";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false },
);
const UpgradeButton = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.UpgradeButton })),
  { ssr: false },
);
const UsageBadge = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.UsageBadge })),
  { ssr: false },
);

/* ------------------------------------------------------------------ */
/*  Primary nav links — ALL surfaced, no hidden dropdown               */
/* ------------------------------------------------------------------ */
const leftNavLinks = [
  { href: "/", label: "Home", icon: Home },
  { href: "/dashboard", label: "Dashboard", icon: Bot },
  { href: "/studio", label: "Studio", icon: Wand2 },
  { href: "/showcase", label: "Showcase", icon: Sparkles },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/discover", label: "Discover", icon: MessageCircle },
  { href: "/pricing", label: "Pricing", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
].filter((link) => {
  // Feature flag filtering for v1 release
  if (link.href === "/games" && !isFeatureEnabled("retroGameRuntime")) return false;
  if (link.href === "/discover" && !isFeatureEnabled("communitySocial")) return false;
  return true;
});

const agentsLink = { href: "/agents", label: "Agents", icon: BrainCircuit };
const AgentsIcon = agentsLink.icon;

/* ------------------------------------------------------------------ */
/*  Utility items for mobile drawer                                    */
/* ------------------------------------------------------------------ */
const mobileDrawerGroups = [
  { label: "Home", links: [{ href: "/dashboard", label: "Command Center", icon: Home }] },
  { label: "Create", links: [{ href: "/studio", label: "Studio", icon: Wand2 }, { href: "/showcase", label: "Showcase", icon: Sparkles }] },
  { label: "Discover", links: [{ href: "/discover", label: "Discover Feed", icon: MessageCircle }, { href: "/marketplace", label: "Marketplace", icon: ShoppingBag }] },
  { label: "Games", links: [{ href: "/games", label: "Games Hub", icon: Gamepad2 }] },
  { label: "Account", links: [{ href: "/profile", label: "Profile", icon: User }, { href: "/settings", label: "Settings", icon: Settings }] },
].filter((group) => {
  if (group.label === "Discover" && !isFeatureEnabled("communitySocial")) return false;
  if (group.label === "Games" && !isFeatureEnabled("retroGameRuntime")) return false;
  return true;
});

export default function Navbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { theme, resolvedColors, setMode } = useTheme();
  const { profile } = useProfile();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const { isLoaded: authLoaded, isSignedIn } = useClerkAuth();

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all: true }),
      });
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read_at: new Date().toISOString() })),
      );
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!isSignedIn) return;
    const fetchNotifications = async () => {
      try {
        const [listRes, countRes] = await Promise.all([
          fetch("/api/notifications?limit=20"),
          fetch("/api/notifications/count"),
        ]);
        const listData = await listRes.json();
        const countData = await countRes.json();
        setNotifications(listData.notifications || []);
        setUnreadCount(countData.count || 0);
      } catch {
        /* ignore */
      }
    };
    const id = requestAnimationFrame(() => fetchNotifications());
    const interval = setInterval(() => {
      if (!document.hidden) fetchNotifications();
    }, 15000);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(interval);
    };
  }, [isSignedIn]);

  /* Close dropdowns on outside click + close mobile drawer on desktop resize */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setNotifOpen(false);
      if (mobileOpen && !hamburgerRef.current?.contains(e.target as Node))
        setMobileOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previous; };
  }, [mobileOpen]);

  /* Close mobile menu on route change */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setMobileOpen(false);
      setNotifOpen(false);
    });
    return () => cancelAnimationFrame(id);
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
      <div className="w-full px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo — icon-only on mobile, icon + text on desktop */}
          <BrandLogo
            href="/"
            size={30}
            showText={false}
            className="sm:hidden"
          />
          <BrandLogo
            href="/"
            size={30}
            showText
            className="hidden sm:inline-flex"
          />

          {/* Desktop Nav */}
          <div
            className="hidden lg:flex items-center gap-1 bg-opacity-40 px-1 py-1 rounded-xl"
            style={{
              backgroundColor: resolvedColors.boxBg + "40",
              border: `1px solid ${resolvedColors.borderColor}20`,
            }}
          >
            {leftNavLinks.map((link) => {
              const active = isActive(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="relative flex items-center gap-1.5 px-2 xl:px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all duration-200"
                  style={{
                    color: active
                      ? resolvedColors.bgColor
                      : resolvedColors.textMuted,
                    backgroundColor: active
                      ? resolvedColors.accentColor
                      : "transparent",
                    boxShadow: active
                      ? `0 0 12px ${resolvedColors.accentColor}50`
                      : "none",
                  }}
                  title={link.label}
                  aria-label={link.label}
                  data-testid={link.href === "/" ? "nav-home" : `nav-${link.href.slice(1)}`}
                >
                  <Icon size={12} strokeWidth={active ? 2.5 : 2} />
                  <span className="hidden xl:inline">{link.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Right side — clean horizontal group */}
          <div className="flex items-center gap-2.5">
            {/* LiTTBits / Usage badge — only when signed in */}
            {authLoaded && isSignedIn && (
              <UsageBadge accentColor={resolvedColors.accentColor} />
            )}

            {/* Agents — dedicated quick-access icon */}
            <Link
              href={agentsLink.href}
              className="hidden sm:flex w-9 h-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200 hover:scale-110"
              style={{
                border: `1px solid ${
                  isActive(agentsLink.href)
                    ? resolvedColors.accentColor
                    : resolvedColors.accentColor + "30"
                }`,
                color: resolvedColors.accentColor,
                backgroundColor: isActive(agentsLink.href)
                  ? resolvedColors.accentColor + "25"
                  : resolvedColors.accentColor + "08",
                boxShadow: isActive(agentsLink.href)
                  ? `0 0 12px ${resolvedColors.accentColor}50`
                  : "none",
              }}
              title={agentsLink.label}
              aria-label={agentsLink.label}
            >
              <AgentsIcon
                size={17}
                strokeWidth={isActive(agentsLink.href) ? 2.5 : 2}
              />
            </Link>

            {/* Notification bell */}
            <div className="relative shrink-0" ref={notifRef}>
              <button
                onClick={() => {
                  setNotifOpen((v) => !v);
                  if (!notifOpen && unreadCount > 0) markAllRead();
                }}
                className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-110 relative"
                style={{
                  border: `1px solid ${resolvedColors.accentColor}30`,
                  color: resolvedColors.accentColor,
                  backgroundColor: resolvedColors.accentColor + "08",
                }}
                title="Notifications"
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-black px-1"
                    style={{
                      backgroundColor: resolvedColors.headerColor,
                      color: "#fff",
                    }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div
                  className="absolute top-full right-0 mt-2 py-2 rounded-lg border min-w-70 max-h-100 overflow-y-auto z-50"
                  style={{
                    backgroundColor: resolvedColors.boxBg + "f0",
                    borderColor: resolvedColors.borderColor + "40",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <div className="flex items-center justify-between px-3 py-1.5 mb-1">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: resolvedColors.textMuted }}
                    >
                      Notifications
                    </span>
                    {notifications.length > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-[9px] font-bold hover:opacity-70 transition-opacity"
                        style={{ color: resolvedColors.linkColor }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <div
                      className="px-3 py-4 text-[11px] text-center"
                      style={{ color: resolvedColors.textMuted }}
                    >
                      No notifications yet
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-2 px-3 py-2 rounded-lg mx-1 transition-colors hover:bg-white/3"
                          style={{ opacity: n.read_at ? 0.5 : 1 }}
                        >
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0"
                            style={{
                              backgroundColor:
                                resolvedColors.accentColor + "12",
                            }}
                          >
                            {n.type === "follow"
                              ? "👤"
                              : n.type === "like"
                                ? "♥"
                                : n.type === "comment"
                                  ? "💬"
                                  : "🔔"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-[11px] leading-snug"
                              style={{ color: resolvedColors.textColor }}
                            >
                              <span className="font-bold">
                                {n.users?.name || "Someone"}
                              </span>{" "}
                              {n.content}
                            </div>
                            <div className="text-[9px] opacity-40 mt-0.5">
                              {n.created_at
                                ? new Date(n.created_at).toLocaleDateString()
                                : ""}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Theme toggle */}
            <button
              onClick={() => setMode(theme.mode === "dark" ? "light" : "dark")}
              aria-label={
                theme.mode === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-110"
              style={{
                border: `1px solid ${resolvedColors.accentColor}30`,
                color: resolvedColors.accentColor,
                backgroundColor: resolvedColors.accentColor + "08",
              }}
              title="Toggle dark/light"
            >
              {theme.mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Upgrade button — dedicated control, never overlaps profile */}
            {authLoaded && isSignedIn && <UpgradeButton />}

            {/* Profile menu — ONE clean control */}
            <NavAuth linkColor={resolvedColors.accentColor} />

            {/* Mobile hamburger */}
            <button
              ref={hamburgerRef}
              onClick={(e) => {
                e.stopPropagation();
                setMobileOpen((open) => !open);
                onMenuClick?.();
              }}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              className="lg:hidden w-9 h-9 shrink-0 flex items-center justify-center rounded-lg"
              style={{ color: resolvedColors.linkColor }}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer — slide down from nav bottom */}
      {mobileOpen && (
        <>
          {/* Tap-outside scrim */}
          <div
            className="fixed inset-0 z-10000 bg-black/70 lg:hidden"
            onClick={() => setMobileOpen(false)}
            onTouchStart={() => setMobileOpen(false)}
          />
          {/* Drawer panel */}
          <div
            className="fixed inset-y-0 left-0 z-10001 flex h-dvh w-[min(88vw,340px)] flex-col overflow-hidden border-r lg:hidden"
            style={{
              backgroundColor: resolvedColors.bgColor,
              borderColor: resolvedColors.borderColor + "35",
              boxShadow: `18px 0 50px rgba(0,0,0,0.65)`,
            }}
          >
            <header className="flex shrink-0 items-center gap-3 border-b px-4 py-4" style={{ borderColor: resolvedColors.borderColor + "25" }}>
              {profile?.avatarUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                </>
              ) : (
                <div className="grid h-11 w-11 place-items-center rounded-full text-sm font-black" style={{ backgroundColor: resolvedColors.accentColor + "22", color: resolvedColors.accentColor }}>{profile?.displayName?.[0]?.toUpperCase() || "U"}</div>
              )}
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-black" style={{ color: resolvedColors.textColor }}>{profile?.displayName || "Member"}</div><div className="truncate text-[10px]" style={{ color: resolvedColors.textMuted }}>@{profile?.username || "creator"}</div></div>
              <button onClick={() => setMobileOpen(false)} className="rounded-xl p-2" style={{ color: resolvedColors.textMuted }} aria-label="Close menu"><X size={18} /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
              {mobileDrawerGroups.map((group) => <section key={group.label} className="mb-4"><div className="px-2 pb-1.5 text-[9px] font-black uppercase tracking-[.18em]" style={{ color: resolvedColors.textMuted }}>{group.label}</div><div className="space-y-1">{group.links.map((link) => { const Icon = link.icon; const active = isActive(link.href); return <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold" style={{ color: active ? resolvedColors.accentColor : resolvedColors.textColor, backgroundColor: active ? resolvedColors.accentColor + "12" : "transparent" }}><Icon size={18} />{link.label}</Link>; })}</div></section>)}
            </div>

            <div
              className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"
              style={{ borderColor: resolvedColors.borderColor + "30" }}
            >
              <div className="flex items-center gap-2">
                {authLoaded && isSignedIn ? (
                  <UsageBadge accentColor={resolvedColors.accentColor} />
                ) : (
                  <>
                    <Coins
                      size={12}
                      style={{ color: resolvedColors.accentColor }}
                    />
                    <span
                      className="text-xs font-bold"
                      style={{ color: resolvedColors.accentColor }}
                    >
                      Sign In
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={() =>
                  setMode(theme.mode === "dark" ? "light" : "dark")
                }
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border"
                style={{
                  borderColor: resolvedColors.borderColor + "40",
                  color: resolvedColors.textMuted,
                }}
              >
                {theme.mode === "dark" ? <Sun size={13} /> : <Moon size={13} />}
                {theme.mode === "dark" ? "Light Mode" : "Dark Mode"}
              </button>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
