"use client";

/**
 * NavAuth — the ONE clean profile control for the authenticated header.
 *
 * Replaces the previous mess of:
 *   - Custom avatar + chevron dropdown (Navbar.tsx userRef)
 *   - NavAuth with its own avatar + name + Clerk UserButton (3 avatars!)
 *
 * Now: ONE profile control with:
 *   - 36px circular avatar (with LiTT green ring when online)
 *   - One-line name (no wrap, truncate)
 *   - Optional plan/workspace label below in 11px
 *   - Chevron directly beside the text
 *   - Min width 150px desktop
 *   - Dark glass background, subtle border, clean hover
 *   - Entire control clickable → opens dropdown
 *
 * Dropdown includes:
 *   - Account
 *   - Workspace
 *   - Plan and billing
 *   - Usage
 *   - Settings
 *   - Sign out (Clerk)
 *
 * On narrower screens: hide secondary label
 * On mobile: avatar only
 */

import Link from "next/link";
import { Component, type ReactNode, useState, useEffect, useRef } from "react";
import { useUser, useClerk, SignInButton } from "@clerk/nextjs";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import { useWallet } from "@/context/WalletContext";
import { LogIn, ChevronDown, User, Settings, CreditCard, BarChart3, LayoutGrid, LogOut, Coins } from "lucide-react";

type NavAuthProps = {
  linkColor?: string;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/* Error boundary catches Clerk hook errors when ClerkProvider is absent */
class ClerkBoundary extends Component<{
  fallback: ReactNode;
  children: ReactNode;
}> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function useCustomSession() {
  const [session, setSession] = useState<{
    user?: { name?: string | null };
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setSession(data);
        setLoaded(true);
      })
      .catch(() => {
        setSession(null);
        setLoaded(true);
      });
  }, []);
  return { session, loaded };
}

/* ------------------------------------------------------------------ */
/*  Custom auth fallback (when Clerk is not configured)                */
/* ------------------------------------------------------------------ */
function CustomAuthFallback({ linkColor }: NavAuthProps) {
  const { session, loaded } = useCustomSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!loaded) {
    return (
      <div
        className="h-10 w-10 rounded-full animate-pulse"
        style={{
          backgroundColor: linkColor + "20",
          border: `1px solid ${linkColor}40`,
        }}
      />
    );
  }

  if (session?.user) {
    const name = session.user.name || "Admin";
    const initial = name.charAt(0).toUpperCase();
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-all hover:opacity-90"
          style={{
            backgroundColor: linkColor + "10",
            border: `1px solid ${linkColor}25`,
            minHeight: 40,
          }}
          aria-label="Profile menu"
          aria-expanded={open}
        >
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white"
            style={{ background: `linear-gradient(135deg, ${linkColor}, #a855f7)` }}
          >
            {initial}
          </div>
          <span className="hidden sm:block text-[12px] font-bold truncate max-w-20" style={{ color: linkColor }}>
            {name}
          </span>
          <ChevronDown size={12} className="hidden sm:block" style={{ color: linkColor, opacity: 0.6 }} />
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-2 w-56 rounded-xl border p-1.5 z-50"
            style={{
              backgroundColor: "#0b1020f0",
              borderColor: "#3b4773",
              backdropFilter: "blur(12px)",
            }}
          >
            <DropdownItem href="/profile" icon={<User size={14} />} label="Account" />
            <DropdownItem href="/settings" icon={<Settings size={14} />} label="Settings" />
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5"
                style={{ color: "#ef4444" }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <SignInButton mode="redirect" forceRedirectUrl="/dashboard">
      <button
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-bold cursor-pointer transition-all hover:scale-[1.03] active:scale-[0.98]"
        style={{
          background: `linear-gradient(135deg, ${linkColor}22, #a855f722)`,
          color: linkColor,
          border: `1px solid ${linkColor}50`,
        }}
      >
        <LogIn size={13} /> Sign In
      </button>
    </SignInButton>
  );
}

/* ------------------------------------------------------------------ */
/*  Dropdown item                                                       */
/* ------------------------------------------------------------------ */
function DropdownItem({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5"
      style={{ color: "#eef4ff" }}
    >
      {icon} {label}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Upgrade button — dedicated control, never overlaps profile         */
/* ------------------------------------------------------------------ */
function UpgradeButton() {
  return (
    <Link
      href="/pricing"
      className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black transition-all hover:scale-[1.03]"
      style={{
        background: "linear-gradient(135deg, #a855f7, #7c3aed)",
        color: "#ffffff",
        boxShadow: "0 0 16px rgba(168,85,247,0.25)",
        minHeight: 36,
      }}
      aria-label="Upgrade plan"
    >
      Upgrade
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  LiTTBits / Usage badge                                             */
/* ------------------------------------------------------------------ */
function UsageBadge({ accentColor }: { accentColor: string }) {
  const { balance, isLoading } = useWallet();
  return (
    <span
      className="hidden md:flex shrink-0 items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
      style={{
        backgroundColor: accentColor + "12",
        color: accentColor,
        border: `1px solid ${accentColor}25`,
        minHeight: 36,
      }}
      title="Your LiTTBits balance"
    >
      <Coins size={11} /> {isLoading ? "—" : balance.toLocaleString()}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main authenticated profile control                                 */
/* ------------------------------------------------------------------ */
function AuthInner({ linkColor }: NavAuthProps) {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!isLoaded) {
    return (
      <div
        className="h-10 w-10 rounded-full animate-pulse"
        style={{
          backgroundColor: linkColor + "18",
          border: `1px solid ${linkColor}30`,
        }}
      />
    );
  }

  if (!isSignedIn) {
    return (
      <SignInButton mode="redirect" forceRedirectUrl="/dashboard">
        <button
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-bold cursor-pointer transition-all hover:scale-[1.03] active:scale-[0.98]"
          style={{
            background: `linear-gradient(135deg, ${linkColor}22, #a855f722)`,
            color: linkColor,
            border: `1px solid ${linkColor}50`,
          }}
        >
          <LogIn size={13} /> Sign In
        </button>
      </SignInButton>
    );
  }

  const firstName = user?.firstName || profile?.displayName || user?.username || "You";
  const username = profile?.username || user?.username || "creator";
  const avatarUrl = profile?.avatarUrl || user?.imageUrl || null;
  const initial = firstName.charAt(0).toUpperCase();

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-all hover:opacity-90"
        style={{
          backgroundColor: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(168,85,247,0.15)",
          minHeight: 40,
          minWidth: 56,
        }}
        aria-label="Profile menu"
        aria-expanded={open}
        title={`${firstName} — ${username}`}
      >
        {/* Avatar — 36px with green ring when online */}
        <div className="relative shrink-0">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={firstName}
              className="h-8 w-8 rounded-full object-cover"
              style={{ border: "2px solid #B6FF4A" }}
            />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-black text-white"
              style={{
                background: `linear-gradient(135deg, ${linkColor}, #a855f7)`,
                border: "2px solid #B6FF4A",
              }}
            >
              {initial}
            </div>
          )}
          {/* Online dot */}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
            style={{
              background: "#B6FF4A",
              boxShadow: "0 0 6px #B6FF4A, 0 0 0 1.5px #060410",
            }}
          />
        </div>

        {/* Name + secondary label — hidden on narrow screens */}
        <div className="hidden sm:flex min-w-0 flex-col leading-tight" style={{ minWidth: 80, maxWidth: 140 }}>
          <span
            className="text-[12px] font-bold truncate"
            style={{ color: "#eef4ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {firstName}
          </span>
          <span
            className="text-[10px] font-medium truncate"
            style={{ color: "rgba(238,244,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            @{username}
          </span>
        </div>

        {/* Chevron — hidden on mobile */}
        <ChevronDown
          size={13}
          className="hidden sm:block shrink-0 transition-transform"
          style={{
            color: "rgba(238,244,255,0.4)",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      {/* Dropdown — 240px wide, not cramped */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-60 rounded-xl border p-1.5 z-50"
          style={{
            backgroundColor: "#0b1020f0",
            borderColor: "rgba(168,85,247,0.2)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 0 24px rgba(168,85,247,0.08)",
          }}
        >
          {/* User info header */}
          <div className="mb-1.5 rounded-lg px-3 py-2" style={{ background: "rgba(168,85,247,0.06)" }}>
            <p className="truncate text-xs font-black" style={{ color: "#eef4ff" }}>{firstName}</p>
            <p className="truncate text-[10px]" style={{ color: "rgba(238,244,255,0.4)" }}>@{username}</p>
          </div>

          <DropdownItem href="/profile" icon={<User size={14} />} label="Account" />
          <DropdownItem href="/dashboard" icon={<LayoutGrid size={14} />} label="Workspace" />
          <DropdownItem href="/pricing" icon={<CreditCard size={14} />} label="Plan and billing" />
          <DropdownItem href="/wallet" icon={<BarChart3 size={14} />} label="Usage" />
          <DropdownItem href="/settings" icon={<Settings size={14} />} label="Settings" />

          {/* Divider */}
          <div className="my-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

          {/* Sign out */}
          <button
            onClick={() => signOut({ redirectUrl: "/" })}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5"
            style={{ color: "#ef4444" }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public exports                                                     */
/* ------------------------------------------------------------------ */

export function NavAuth({ linkColor = "#6366f1" }: NavAuthProps) {
  if (!clerkConfigured) {
    return <CustomAuthFallback linkColor={linkColor} />;
  }

  return (
    <ClerkBoundary fallback={<CustomAuthFallback linkColor={linkColor} />}>
      <AuthInner linkColor={linkColor} />
    </ClerkBoundary>
  );
}

/** Upgrade button — exported for use in the header */
export { UpgradeButton, UsageBadge };
