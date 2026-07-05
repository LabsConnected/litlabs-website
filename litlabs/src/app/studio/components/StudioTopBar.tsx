"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import ModelPicker from "@/components/ModelPicker";
import {
  Activity,
  Bell,
  Coins,
  HeartPulse,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { UserProfile } from "@/context/ProfileContext";

/**
 * StudioTopBar — the global status strip for the Command Center.
 *
 *  [ search ] [ model ]  ...  [ wallet ] [ health ] [ notif ] [ profile ]
 *
 * Mobile (<md) collapses everything into a compact strip with a hamburger
 * that opens the sidebar drawer.
 */
export default function StudioTopBar({
  search,
  onSearchChange,
  selectedModel,
  onModelChange,
  onMenuToggle,
  onInspectorToggle,
  T,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  selectedModel: string;
  onModelChange: (m: string) => void;
  onMenuToggle?: () => void;
  onInspectorToggle?: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const { balance, isLoading: walletLoading } = useWallet();
  const { isSignedIn } = useClerkAuth();
  const { profile } = useProfile();
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3"
      style={{
        backgroundColor: T.boxBg + "d0",
        borderColor: T.borderColor + "20",
        backdropFilter: "blur(14px) saturate(180%)",
      }}
    >
      {onMenuToggle && (
        <button
          onClick={onMenuToggle}
          className="md:hidden rounded-lg p-2 transition-all hover:bg-white/10"
          style={{ color: T.textMuted }}
          aria-label="Open menu"
          title="Open menu"
        >
          <Menu size={16} />
        </button>
      )}

      <div className="md:hidden flex items-center gap-1.5 pr-1">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
          }}
        >
          <Sparkles size={10} className="text-white" />
        </div>
      </div>

      <div
        className="relative flex-1 max-w-md min-w-0"
        style={{ color: T.textMuted }}
      >
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
        />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tools, agents, projects…"
          className="w-full rounded-lg border pl-7 pr-7 py-1.5 text-[11px] outline-none transition-all focus:ring-1"
          style={{
            backgroundColor: T.bgColor + "70",
            borderColor: T.borderColor + "25",
            color: T.textColor,
            // @ts-expect-error custom css var
            "--tw-ring-color": T.accentColor + "60",
          }}
        />
        {search && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div className="hidden sm:block">
        <ModelPicker
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          recentModels={["adaptive", "gpt-4o", "claude-3.5-sonnet"]}
        />
      </div>

      <div className="flex-1" />

      <HealthPulse T={T} />

      <div
        className="hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold"
        title="LiTBit Coins balance"
        style={{
          backgroundColor: T.bgColor + "60",
          borderColor: T.borderColor + "20",
          color: T.textColor,
        }}
      >
        <Coins size={11} style={{ color: T.accentColor }} />
        <span style={{ color: T.accentColor }}>
          {walletLoading ? "—" : balance.toLocaleString()}
        </span>
        <span className="opacity-50 text-[9px] uppercase tracking-wider">
          LBC
        </span>
      </div>

      <div className="relative">
        <button
          onClick={() => setNotifOpen((v) => !v)}
          className="rounded-lg p-2 transition-all hover:bg-white/10"
          style={{ color: T.textMuted }}
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell size={14} />
          <span
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "#ff3a3a", boxShadow: "0 0 4px #ff3a3a" }}
          />
        </button>
        {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} T={T} />}
      </div>

      <ProfileChip isSignedIn={isSignedIn} profile={profile} T={T} />

      {onInspectorToggle && (
        <button
          onClick={onInspectorToggle}
          className="md:hidden rounded-lg p-2 transition-all hover:bg-white/10"
          style={{ color: T.textMuted }}
          aria-label="Open inspector"
          title="Open inspector"
        >
          <Activity size={16} />
        </button>
      )}
    </header>
  );
}

/* ── Health pulse ─────────────────────────────────────────────── */
function HealthPulse({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div
      className="hidden md:flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold"
      title="System health"
      style={{
        backgroundColor: T.bgColor + "60",
        borderColor: T.borderColor + "20",
        color: T.textColor,
      }}
    >
      <HeartPulse size={11} style={{ color: T.success }} />
      <span style={{ color: T.success }}>99.9%</span>
      <span className="opacity-50 text-[9px] uppercase tracking-wider">
        UPTIME
      </span>
    </div>
  );
}

/* ── Profile chip ─────────────────────────────────────────────── */
function ProfileChip({
  isSignedIn,
  profile,
  T,
}: {
  isSignedIn: boolean;
  profile: UserProfile | null;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const name = profile?.displayName || profile?.username || "User";
  const initial = name.slice(0, 1).toUpperCase();
  return (
    <div
      className="flex items-center gap-2 rounded-lg border pl-1 pr-2.5 py-0.5"
      style={{
        backgroundColor: T.bgColor + "60",
        borderColor: T.borderColor + "20",
      }}
    >
      {profile?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatarUrl}
          alt={name}
          className="w-5 h-5 rounded-md object-cover"
        />
      ) : (
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
            color: "#fff",
          }}
        >
          {initial}
        </div>
      )}
      <div className="hidden sm:flex flex-col leading-none">
        <span className="text-[10px] font-bold" style={{ color: T.textColor }}>
          {isSignedIn ? name : "Guest"}
        </span>
        <span
          className="text-[8px] uppercase tracking-wider mt-0.5"
          style={{ color: T.textMuted }}
        >
          {isSignedIn ? "Pro" : "Sign in"}
        </span>
      </div>
      <ShieldCheck
        size={10}
        className="hidden sm:block"
        style={{ color: T.success, opacity: 0.7 }}
      />
    </div>
  );
}

/* ── Notifications panel ──────────────────────────────────────── */
function NotifPanel({
  onClose,
  T,
}: {
  onClose: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const items = [
    { icon: Sparkles, label: "Director finished planning", time: "now" },
    { icon: Activity, label: "Code Champion deployed v1.2", time: "2m" },
    { icon: ShieldCheck, label: "Wallet claimed 250 LBC", time: "12m" },
  ];
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        className="absolute right-0 top-full mt-1 w-72 rounded-2xl border p-3 shadow-2xl z-40"
        style={{
          backgroundColor: T.boxBg,
          borderColor: T.borderColor + "30",
          boxShadow: `0 12px 40px rgba(0,0,0,0.5)`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ color: T.headerColor }}
          >
            Notifications
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Close notifications"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
        <div className="space-y-1">
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-xl p-2 transition-colors hover:bg-white/5 cursor-pointer"
                style={{ backgroundColor: T.bgColor + "60" }}
              >
                <Icon
                  size={12}
                  style={{ color: T.accentColor, marginTop: 1 }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[11px] font-bold"
                    style={{ color: T.textColor }}
                  >
                    {it.label}
                  </div>
                  <div
                    className="text-[9px] uppercase tracking-wider mt-0.5"
                    style={{ color: T.textMuted }}
                  >
                    {it.time}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
