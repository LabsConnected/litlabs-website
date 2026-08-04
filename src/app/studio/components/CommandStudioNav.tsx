"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Wand2,
  FolderOpen,
  Bot,
  MoreHorizontal,
  Puzzle,
  Camera,
  MonitorUp,
  Rocket,
  Terminal,
  Network,
  X,
  Gamepad2,
  ExternalLink,
  Zap,
  Home,
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
  { id: "create", label: "Create", icon: Wand2 },
  { id: "assets", label: "Assets", icon: FolderOpen },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "more", label: "More", icon: MoreHorizontal },
];

const MORE_MODES: { id: MoreMode; label: string; icon: typeof Puzzle }[] = [
  { id: "plugins", label: "Plugins", icon: Puzzle },
  { id: "camera", label: "Camera", icon: Camera },
  { id: "screen", label: "Screen", icon: MonitorUp },
  { id: "space", label: "Space", icon: Rocket },
  { id: "clibridge", label: "CLI Bridge", icon: Terminal },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "workflows", label: "Mission Forge", icon: Network },
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
        {/* LiTT logo mark */}
        <Link
          href="/dashboard"
          className="group relative mb-1 flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:scale-105"
          style={{
            background: "linear-gradient(135deg, var(--litt-primary), var(--spark-primary))",
            boxShadow: "var(--studio-glow-purple)",
          }}
          title="LiTT Studio — AI Operating System"
          aria-label="Go to dashboard"
        >
          <Zap
            size={16}
            strokeWidth={2.5}
            className="text-black pointer-events-none"
          />
        </Link>

        {/* Divider between logo and nav items */}
        <div
          className="mb-1 h-px w-7"
          style={{ backgroundColor: "var(--studio-border-strong)" }}
          aria-hidden
        />

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          const isMore = item.id === "more";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (isMore) {
                  setMoreOpen((v) => !v);
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
                className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-bold opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-50"
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

        {/* Plan / LiTTBits usage footer */}
        <Link
          href="/wallet"
          className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:bg-white/8"
          style={{ color: "var(--text-muted)" }}
          title={`LiTTBits: ${balance.toLocaleString()}`}
          aria-label="View wallet"
        >
          <div className="flex flex-col items-center pointer-events-none">
            <Zap
              size={14}
              strokeWidth={2}
              style={{ color: "var(--litt-primary)" }}
              className="pointer-events-none"
            />
            <span
              className="text-[7px] font-black leading-none mt-0.5"
              style={{ color: "var(--text-secondary)" }}
            >
              {balance >= 1000 ? `${(balance / 1000).toFixed(1)}k` : balance}
            </span>
          </div>
          <span
            className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-bold opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-50"
            style={{
              backgroundColor: "var(--studio-elevated)",
              borderColor: "var(--studio-border-strong)",
              color: "var(--text-primary)",
            }}
          >
            {balance.toLocaleString()} LiTTBits
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
            <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
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
            <div className="my-1 h-px" style={{ backgroundColor: "var(--studio-border)" }} />
            <Link
              href="/games"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              <Gamepad2 size={16} strokeWidth={1.7} className="pointer-events-none shrink-0" />
              <span className="text-xs font-bold">Games</span>
              <ExternalLink size={11} className="ml-auto opacity-40 pointer-events-none" />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Mobile bottom tab bar — 5 destinations ────────────────────── */
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
        height: "calc(52px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
        backgroundColor: "var(--studio-surface)",
        borderTop: "1px solid var(--studio-border)",
      }}
    >
      {/* Home — navigate back to dashboard */}
      <Link
        href="/dashboard"
        className="flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors"
        style={{ color: "var(--text-muted)" }}
        aria-label="Go to dashboard"
      >
        <Home size={18} strokeWidth={1.7} className="pointer-events-none" />
        <span className="text-[9px] font-bold">Home</span>
      </Link>

      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors"
            style={{
              color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
            }}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={18} strokeWidth={isActive ? 2.2 : 1.7} className="pointer-events-none" />
            <span className="text-[9px] font-bold">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
