"use client";

interface Notification {
  id: string;
  type?: "follow" | "like" | "comment" | "system";
  read_at?: string | null;
  created_at?: string;
  users?: { name?: string } | null;
  content?: string;
  [key: string]: unknown;
}

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSessionAuth } from "@/hooks/useSessionAuth";
import dynamic from "next/dynamic";
import {
  Home,
  ShoppingBag,
  Sparkles,
  Settings,
  Sun,
  Moon,
  ChevronDown,
  X,
  Menu,
  Bell,
  Coins,
  User,
  Wand2,
  BrainCircuit,
  Gamepad2,
  MessageCircle,
  UserPlus,
  Heart,
} from "lucide-react";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false },
);

/* ------------------------------------------------------------------ */
/*  Primary nav links -- ALL surfaced, no hidden dropdown                */
/* ------------------------------------------------------------------ */
const primaryNavLinks = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/studio", label: "Studio", icon: Wand2 },
  { href: "/agents", label: "Agents", icon: BrainCircuit },
  { href: "/gallery", label: "Gallery", icon: Sparkles },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/social", label: "Social", icon: MessageCircle },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;


/* ------------------------------------------------------------------ */
/*  Utility items for mobile / user dropdown                           */
/* ------------------------------------------------------------------ */
const userLinks = [
  { href: "/profile", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
];

const mobileDrawerGroups = [
  {
    label: "Workspace",
    links: [
      primaryNavLinks[0],
      primaryNavLinks[1],
      primaryNavLinks[2],
    ],
  },
  {
    label: "Explore",
    links: [
      primaryNavLinks[3],
      primaryNavLinks[4],
      primaryNavLinks[5],
      primaryNavLinks[6],
    ],
  },
  {
    label: "Account",
    links: [
      { href: "/profile", label: "Profile", icon: User },
      primaryNavLinks[7],
    ],
  },
];

function WalletBadge({
  accentColor,
  alwaysVisible = false,
}: {
  accentColor: string;
  alwaysVisible?: boolean;
}) {
  const { balance, isLoading } = useWallet();
  return (
    <span
      className={`
        items-center gap-1 rounded px-2 py-0.5 text-xs font-bold
        ${alwaysVisible ? "flex" : "hidden sm:flex"}
      `}
      style={{
        backgroundColor: `${accentColor}15`,
        color: accentColor,
        border: `1px solid ${accentColor}30`,
      }}
      title="Your LiTBit Coins balance"
    >
      <Coins className="pointer-events-none" size={10} aria-hidden="true" />
      {isLoading ? "—" : balance.toLocaleString()}
    </span>
  );
}

function NotificationTypeIcon({
  type,
}: {
  type?: Notification["type"];
}) {
  if (type === "follow") return <UserPlus className="pointer-events-none" size={12} aria-hidden="true" />;
  if (type === "like") return <Heart className="pointer-events-none" size={12} aria-hidden="true" />;
  if (type === "comment") return <MessageCircle className="pointer-events-none" size={12} aria-hidden="true" />;
  return <Bell className="pointer-events-none" size={12} aria-hidden="true" />;
}

export default function Navbar() {
  const { theme, resolvedColors, setMode } = useTheme();
  const { profile } = useProfile();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useClerkAuth();
  const { isLoaded: sessionLoaded, isSignedIn: sessionSignedIn } =
    useSessionAuth();
  const authLoaded = clerkLoaded || sessionLoaded;
  const isSignedIn = clerkSignedIn || sessionSignedIn;

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
    const controller = new AbortController();

    const fetchNotifications = async () => {
      try {
        const [listResponse, countResponse] = await Promise.all([
          fetch("/api/notifications?limit=20", { signal: controller.signal }),
          fetch("/api/notifications/count", { signal: controller.signal }),
        ]);

        if (!listResponse.ok || !countResponse.ok) return;

        const listData = await listResponse.json();
        const countData = await countResponse.json();
        setNotifications(listData.notifications ?? []);
        setUnreadCount(countData.count ?? 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        /* ignore */
      }
    };

    void fetchNotifications();

    const interval = window.setInterval(() => {
      if (!document.hidden) void fetchNotifications();
    }, 60_000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [isSignedIn]);

  /* Close dropdowns on outside click */
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (userRef.current && !userRef.current.contains(target)) {
        setUserOpen(false);
      }

      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }

      if (
        mobileOpen &&
        !hamburgerRef.current?.contains(target) &&
        !drawerRef.current?.contains(target)
      ) {
        setMobileOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    requestAnimationFrame(() => {
      const firstFocusable =
        drawerRef.current?.querySelector<HTMLElement>(
          'a, button, [tabindex]:not([tabindex="-1"])',
        );
      firstFocusable?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [mobileOpen]);

  /* Close mobile menu on route change */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setMobileOpen(false);
      setUserOpen(false);
      setNotifOpen(false);
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

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
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <div
              className="relative w-8 h-8 rounded-lg overflow-hidden transition-transform duration-300 group-hover:scale-105"
              style={{ border: `1px solid ${resolvedColors.accentColor}40` }}
            >
              <Image
                src="/logo.png"
                alt="LiTTree LabStudios"
                fill
                className="object-contain p-0.5"
                unoptimized
              />
            </div>
            <div
              className="hidden sm:flex flex-col leading-none px-2 py-1 rounded-lg"
              style={{
                backgroundColor: resolvedColors.bgColor + "60",
                backdropFilter: "blur(4px)",
              }}
            >
              <span
                className="font-black text-[13px] tracking-tight"
                style={{
                  color: resolvedColors.textColor,
                  textShadow: `0 0 12px ${resolvedColors.accentColor}60, 0 1px 2px ${resolvedColors.bgColor}`,
                }}
              >
                LiTTree LabStudios
              </span>
              <span
                className="text-[9px] font-bold tracking-widest uppercase"
                style={{
                  color: resolvedColors.textMuted,
                  opacity: 0.9,
                  textShadow: `0 0 8px ${resolvedColors.bgColor}`,
                }}
              >
                AI Platform
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <div
            className="hidden lg:flex items-center gap-1 bg-opacity-40 px-1 py-1 rounded-xl"
            style={{
              backgroundColor: resolvedColors.boxBg + "40",
              border: `1px solid ${resolvedColors.borderColor}20`,
            }}
          >
            {primaryNavLinks.map((link) => {
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
                >
                  <Icon size={12} strokeWidth={active ? 2.5 : 2} />
                  <span className="hidden xl:inline">{link.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* LitCoins wallet -- only when signed in */}
            {authLoaded && isSignedIn && (
              <WalletBadge accentColor={resolvedColors.accentColor} />
            )}


            {/* Notification bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => {
                  setNotifOpen((open) => !open);
                  setUserOpen(false);
                }}
                className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-110 relative"
                style={{
                  border: `1px solid ${resolvedColors.accentColor}30`,
                  color: resolvedColors.accentColor,
                  backgroundColor: resolvedColors.accentColor + "08",
                }}
                title="Notifications"
                aria-expanded={notifOpen}
                aria-controls="notification-panel"
              >
                <Bell className="pointer-events-none" size={16} aria-hidden="true" />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full flex items-center justify-center text-[8px] font-black px-1"
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
                  id="notification-panel"
                  role="region"
                  aria-label="Notifications"
                  className="absolute top-full right-0 mt-2 py-2 rounded-lg border min-w-[280px] max-h-[400px] overflow-y-auto z-50"
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
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                            style={{
                              backgroundColor:
                                resolvedColors.accentColor + "12",
                              color: resolvedColors.accentColor,
                            }}
                          >
                            <NotificationTypeIcon type={n.type} />
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
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 hover:scale-110"
              style={{
                border: `1px solid ${resolvedColors.accentColor}30`,
                color: resolvedColors.accentColor,
                backgroundColor: resolvedColors.accentColor + "08",
              }}
              title="Toggle dark/light"
            >
              {theme.mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* User dropdown (profile/settings links) -- desktop, signed-in only */}
            {authLoaded && isSignedIn && (
              <div className="hidden md:block relative" ref={userRef}>
                <button
                  onClick={() => {
                    setUserOpen((open) => !open);
                    setNotifOpen(false);
                  }}
                  aria-label="User menu"
                  aria-expanded={userOpen}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg transition-all hover:opacity-80"
                  style={{
                    border: `1px solid ${resolvedColors.borderColor}30`,
                    backgroundColor: resolvedColors.boxBg + "60",
                  }}
                  title="Menu"
                >
                  {profile?.avatarUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={profile.avatarUrl}
                        alt="Profile"
                        className="w-6 h-6 rounded-full object-cover"
                      />
                    </>
                  ) : (
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black"
                      style={{
                        backgroundColor: resolvedColors.accentColor + "30",
                        color: resolvedColors.accentColor,
                      }}
                    >
                      {profile?.displayName?.[0]?.toUpperCase() || "U"}
                    </div>
                  )}
                  <ChevronDown
                    size={12}
                    style={{ color: resolvedColors.textMuted }}
                  />
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
            )}

            {/* Auth -- sign in only; signed-in users use the profile dropdown */}
            {authLoaded && !isSignedIn && (
              <NavAuth linkColor={resolvedColors.accentColor} />
            )}

            {/* Mobile hamburger */}
            <button
              ref={hamburgerRef}
              aria-controls="mobile-navigation-drawer"
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={(e) => {
                e.stopPropagation();
                setMobileOpen((open) => !open);
              }}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg"
              style={{ color: resolvedColors.linkColor }}
            >
              {mobileOpen ? <X className="pointer-events-none" size={20} aria-hidden="true" /> : <Menu className="pointer-events-none" size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer -- slide-in from nav bottom */}
      {mobileOpen && (
        <>
          {/* Tap-outside scrim */}
          <div
            className="fixed inset-0 z-[10000] bg-black/70 lg:hidden"
            onClick={() => setMobileOpen(false)}
            onTouchStart={() => setMobileOpen(false)}
          />
          {/* Drawer panel */}
          <div
            ref={drawerRef}
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="fixed inset-y-0 left-0 z-[10001] flex h-[100dvh] w-[min(88vw,340px)] flex-col overflow-hidden border-r lg:hidden"
            style={{
              backgroundColor: resolvedColors.bgColor,
              borderColor: resolvedColors.borderColor + "35",
              boxShadow: `18px 0 50px rgba(0,0,0,0.65)`,
            }}
          >
            <header className="flex shrink-0 items-center gap-3 border-b px-4 py-4" style={{ borderColor: resolvedColors.borderColor + "25" }}>
              {profile?.avatarUrl ? <Image src={profile.avatarUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover" unoptimized /> : <div className="grid h-11 w-11 place-items-center rounded-full text-sm font-black" style={{ backgroundColor: resolvedColors.accentColor + "22", color: resolvedColors.accentColor }}>{profile?.displayName?.[0]?.toUpperCase() || "U"}</div>}
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-black" style={{ color: resolvedColors.textColor }}>{profile?.displayName || "Member"}</div><div className="truncate text-[10px]" style={{ color: resolvedColors.textMuted }}>@{profile?.username || "creator"}</div></div>
              <button onClick={() => setMobileOpen(false)} className="rounded-xl p-2" style={{ color: resolvedColors.textMuted }} aria-label="Close menu"><X className="pointer-events-none" size={18} aria-hidden="true" /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
              {mobileDrawerGroups.map((group) => <section key={group.label} className="mb-4"><div className="px-2 pb-1.5 text-[9px] font-black uppercase tracking-[.18em]" style={{ color: resolvedColors.textMuted }}>{group.label}</div><div className="space-y-1">{group.links.map((link) => { const Icon = link.icon; const active = isActive(link.href); return <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold" style={{ color: active ? resolvedColors.accentColor : resolvedColors.textColor, backgroundColor: active ? resolvedColors.accentColor + "12" : "transparent" }}><Icon className="pointer-events-none" size={18} aria-hidden="true" />{link.label}</Link>; })}</div></section>)}
            </div>

            <div
              className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"
              style={{ borderColor: resolvedColors.borderColor + "30" }}
            >
              <div className="flex items-center gap-2">
                {authLoaded && isSignedIn ? (
                  <WalletBadge
                    accentColor={resolvedColors.accentColor}
                    alwaysVisible
                  />
                ) : (
                  <>
                    <Coins className="pointer-events-none" size={12} style={{ color: resolvedColors.accentColor }} aria-hidden="true" />
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
