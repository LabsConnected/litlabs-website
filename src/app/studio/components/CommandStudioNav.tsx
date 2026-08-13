"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Shapes,
  FolderOpen,
  Bot,
  MoreHorizontal,
  Puzzle,
  Network,
  Terminal,
  X,
  Home,
  Settings as SettingsIcon,
  Plug,
} from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import type {
  StudioDestination,
  MoreMode,
} from "../lib/studio-destinations";

interface NavItem {
  id: StudioDestination;
  label: string;
  icon: typeof LayoutGrid;
}

const NAV_ITEMS: NavItem[] = [
  { id: "studio", label: "Studio", icon: LayoutGrid },
  { id: "create", label: "Create", icon: Shapes },
  { id: "assets", label: "Assets", icon: FolderOpen },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "missions", label: "Missions", icon: Network },
  { id: "more", label: "More", icon: MoreHorizontal },
];

const MORE_MODES: { id: MoreMode; label: string; icon: typeof Puzzle; group: string }[] = [
  { id: "plugins", label: "Plugins", icon: Puzzle, group: "Extensions" },
  { id: "clibridge", label: "CLI Bridge", icon: Terminal, group: "Developer" },
];

/**
 * CommandStudioNav — premium icon rail (56px wide).
 *
 * Compact vertical icon rail with LiTT green active indicator, purple hover
 * glow, and a plan/usage footer pill. The "More" destination opens a drawer
 * of secondary tools.
 */
export default function CommandStudioNav({
  active,
  onSelect,
  onSelectMoreMode,
}: {
  active: StudioDestination;
  onSelect: (dest: StudioDestination) => void;
  onSelectMoreMode?: (mode: MoreMode) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { balance } = useWallet();

  return (
    <>
      <nav
        aria-label="Studio navigation"
        className="hidden md:flex h-full shrink-0 flex-col items-center gap-1 border-r py-2"
        style={{
          width: "var(--studio-nav-w)",
          backgroundColor: "var(--studio-surface)",
          borderRight: "1px solid var(--studio-border)",
        }}
      >
        {/* Clerk UserButton removed — account access is now in the unified
            AppShell sidebar (Wallet, Settings, Profile). */}

        {/* Divider between logo and nav items */}
        <div
          className="mb-1 h-px w-7"
          style={{ backgroundColor: "var(--studio-border-strong)" }}
          aria-hidden
        />

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isMore = item.id === "more";
          const isActive = isMore ? (active === "more" || moreOpen) : active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (isMore) {
                  setMoreOpen((v) => !v);
                  // Don't change destination until a sub-mode is picked
                  return;
                }
                onSelect(item.id);
              }}
              className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:bg-white/8"
              style={{
                color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                backgroundColor: isActive ? "rgba(77,255,98,0.1)" : "transparent",
                boxShadow: isActive ? "var(--studio-glow-green)" : "none",
              }}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && (
                <span
                  className="absolute -left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full"
                  style={{
                    backgroundColor: "var(--litt-primary)",
                    boxShadow: "0 0 6px var(--litt-primary)",
                  }}
                  aria-hidden
                />
              )}
              <Icon
                size={17}
                strokeWidth={isActive ? 2.2 : 1.7}
                className="pointer-events-none transition-all duration-200 group-hover:scale-110"
              />
              <span
                className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[12px] font-bold opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-50"
                style={{
                  backgroundColor: "var(--studio-elevated)",
                  borderColor: "var(--studio-border-strong)",
                  color: "var(--text-primary)",
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}

        {/* Spacer pushes footer to bottom */}
        <div className="flex-1" />

        {/* BITS balance footer — shows AI credits count */}
        <Link
          href="/wallet"
          className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:bg-white/8"
          style={{ color: "var(--text-muted)" }}
          title={`BITS: ${balance.toLocaleString()}`}
          aria-label="View wallet"
        >
          <div className="flex flex-col items-center pointer-events-none">
            <span
              className="text-[11px] font-black leading-none"
              style={{ color: "var(--litt-primary)" }}
            >
              {balance >= 1000 ? `${(balance / 1000).toFixed(1)}k` : balance}
            </span>
            <span
              className="text-[7px] font-bold leading-none mt-0.5 uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              BITS
            </span>
          </div>
          <span
            className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[12px] font-bold opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-50"
            style={{
              backgroundColor: "var(--studio-elevated)",
              borderColor: "var(--studio-border-strong)",
              color: "var(--text-primary)",
            }}
          >
            {balance.toLocaleString()} BITS
          </span>
        </Link>
      </nav>

      {/* More drawer — slides out from nav */}
      {moreOpen && (
        <div
          className="fixed z-50 hidden h-full w-56 flex-col border-r md:flex"
          style={{
            left: "var(--studio-nav-w)",
            top: "var(--studio-header-h)",
            height: "calc(100dvh - var(--studio-header-h))",
            backgroundColor: "var(--studio-elevated)",
            borderRight: "1px solid var(--studio-border-strong)",
            boxShadow: "8px 0 32px rgba(0,0,0,0.5)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            className="flex h-10 items-center justify-between px-3"
            style={{ borderBottom: "1px solid var(--studio-border)" }}
          >
            <span className="text-[11px] font-black tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
              More tools
            </span>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="grid h-7 w-7 place-items-center rounded-lg transition hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close more tools"
            >
              <X size={14} className="pointer-events-none" />
            </button>
          </div>
          <div className="flex flex-col gap-0.5 p-2">
            {MORE_MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelectMoreMode?.(m.id);
                    setMoreOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:bg-white/5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <Icon size={16} strokeWidth={1.7} className="pointer-events-none shrink-0" />
                  <span className="text-xs font-bold">{m.label}</span>
                </button>
              );
            })}

            {/* System links */}
            <div className="my-1 h-px" style={{ backgroundColor: "var(--studio-border)" }} />
            <a href="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:bg-white/5" style={{ color: "var(--text-secondary)" }}>
              <SettingsIcon size={16} strokeWidth={1.7} className="pointer-events-none shrink-0" />
              <span className="text-xs font-bold">Settings</span>
            </a>
            <a href="/settings/connections" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:bg-white/5" style={{ color: "var(--text-secondary)" }}>
              <Plug size={16} strokeWidth={1.7} className="pointer-events-none shrink-0" />
              <span className="text-xs font-bold">Connections</span>
            </a>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Mobile bottom tab bar — 6 destinations, premium ─────────── */
export function MobileCommandNav({
  active,
  onSelect,
}: {
  active: StudioDestination;
  onSelect: (dest: StudioDestination) => void;
}) {
  return (
    <nav
      aria-label="Studio navigation"
      className="flex md:hidden shrink-0 items-stretch border-t"
      style={{
        height: "calc(62px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
        backgroundColor: "rgba(8, 6, 15, 0.85)",
        borderTop: "1px solid var(--studio-border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Home — navigate back to dashboard */}
      <Link
        href="/dashboard"
        className="flex flex-1 flex-col items-center justify-center gap-1 transition-colors"
        style={{ color: "var(--text-muted)" }}
        aria-label="Go to dashboard"
      >
        <Home size={20} strokeWidth={1.8} className="pointer-events-none" />
        <span className="text-[10px] font-bold">Home</span>
      </Link>

      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className="relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors"
            style={{
              color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
            }}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            {isActive && (
              <span
                className="absolute top-0 h-0.5 w-8 rounded-b-full"
                style={{
                  backgroundColor: "var(--litt-primary)",
                  boxShadow: "0 0 8px var(--litt-primary)",
                }}
                aria-hidden
              />
            )}
            <Icon
              size={20}
              strokeWidth={isActive ? 2.3 : 1.8}
              className="pointer-events-none transition-transform"
              style={isActive ? { transform: "scale(1.1)" } : undefined}
            />
            <span className="text-[10px] font-bold">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
