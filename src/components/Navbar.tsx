"use client";

interface Notification {
  id: string;
  read_at?: string | null;
  created_at?: string;
  users?: { name?: string } | null;
  content?: string;
  type?: string;
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
  Settings,
  Sun,
  Moon,
  ChevronDown,
  Menu,
  Bell,
  Coins,
  User,
} from "lucide-react";

const NavAuth = dynamic(
  () => import("@/components/ClerkAuth").then((m) => ({ default: m.NavAuth })),
  { ssr: false },
);

/* ------------------------------------------------------------------ */
/*  User dropdown items                                                 */
/* ------------------------------------------------------------------ */
const userLinks = [
  { href: "/profile", label: "Profile", icon: User },
  { href: "/settings", label: "Settings", icon: Settings },
];

function WalletBadge({ accentColor }: { accentColor: string }) {
  const { balance, isLoading } = useWallet();
  return (
    <span
      className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold"
      style={{
        backgroundColor: accentColor + "15",
        color: accentColor,
        border: `1px solid ${accentColor}30`,
      }}
      title="Your LiTBit Coins balance"
    >
      <Coins size={10} /> {isLoading ? "—" : balance.toLocaleString()}
    </span>
  );
}

interface NavbarProps {
  onMenuClick?: () => void;
}

export default function Navbar({ onMenuClick }: NavbarProps) {
  const { theme, resolvedColors, setMode } = useTheme();
  const { profile } = useProfile();
  const pathname = usePathname();
  const hamburgerRef = useRef<HTMLButtonElement>(null);
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

  /* Close dropdowns on outside click */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node))
        setUserOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setNotifOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* Close dropdowns on route change */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setUserOpen(false);
      setNotifOpen(false);
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

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
                alt="LiTree Lab Studios"
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
                LiTree Labs
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

          {/* Center nav links — hidden on /dashboard where sidebar handles nav */}
          <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {[
              { href: "/dashboard", label: "Dashboard" },
              { href: "/studio", label: "Studio" },
              { href: "/marketplace", label: "Marketplace" },
              { href: "/social", label: "Social" },
            ].map((link) => {
              const active = pathname === link.href || pathname?.startsWith(link.href + "/") || pathname?.startsWith(link.href + "?");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-3 py-1.5 rounded-lg text-sm font-bold transition-all hover:opacity-100"
                  style={{
                    color: active ? resolvedColors.accentColor : resolvedColors.textMuted,
                    backgroundColor: active ? resolvedColors.accentColor + "12" : "transparent",
                    opacity: active ? 1 : 0.7,
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* LitCoins wallet — only when signed in, hide on small */}
            {authLoaded && isSignedIn && (
              <WalletBadge accentColor={resolvedColors.accentColor} />
            )}


            {/* Notification bell */}
            <div className="relative" ref={notifRef}>
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
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0"
                            style={{
                              backgroundColor:
                                resolvedColors.accentColor + "12",
                            }}
                          >
                            {n.type === "follow"
                              ? "👤"
                              : n.type === "like"
                                ? "❤"
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
                              {new Date(n.created_at).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Theme toggle — hidden on very small, shown sm+ */}
            <button
              onClick={() => setMode(theme.mode === "dark" ? "light" : "dark")}
              aria-label={
                theme.mode === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg transition-all duration-200 hover:scale-110"
              style={{
                border: `1px solid ${resolvedColors.accentColor}30`,
                color: resolvedColors.accentColor,
                backgroundColor: resolvedColors.accentColor + "08",
              }}
              title="Toggle dark/light"
            >
              {theme.mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* User dropdown (profile/settings links) — desktop, signed-in only */}
            {authLoaded && isSignedIn && (
              <div className="hidden md:block relative" ref={userRef}>
                <button
                  onClick={() => setUserOpen((v) => !v)}
                  aria-label="Navigation menu"
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

            {/* Auth — always visible: avatar+name when signed in, Sign In button when not */}
            <NavAuth linkColor={resolvedColors.accentColor} />

            {/* Mobile hamburger — triggers Sidebar drawer, only below md */}
            <button
              ref={hamburgerRef}
              onClick={onMenuClick}
              aria-label="Open navigation"
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10"
              style={{ color: resolvedColors.textMuted }}
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </div>

    </nav>
  );
}
