"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import ModelPicker from "@/components/ModelPicker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AGENTS } from "@/lib/agents";
import {
  Activity,
  Bell,
  Coins,
  HeartPulse,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  Bot,
  Image,
  Film,
  Music,
  Palette,
  Code2,
  Terminal,
  LayoutGrid,
  Rocket,
  Wand2,
  Zap,
  Command,
  ArrowRight,
} from "lucide-react";

type CmdItem = {
  id: string;
  label: string;
  type: "tool" | "agent" | "action" | "route";
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  href?: string;
  shortcut?: string;
  keywords: string;
  ghost?: boolean;
};

const TOOL_ITEMS: CmdItem[] = [
  { id: "chat", label: "LiTT CODE", type: "tool", icon: Bot, href: "/studio?tool=chat", shortcut: "1", keywords: "chat talk ask ai lit assistant builder terminal agents code" },
  { id: "image", label: "Generate Image", type: "tool", icon: Image, href: "/studio?tool=image", shortcut: "1", keywords: "image picture photo generate art wallpaper logo" },
  { id: "video", label: "Video", type: "tool", icon: Film, href: "/studio?tool=video", shortcut: "2", keywords: "video film clip animation movie" },
  { id: "audio", label: "Audio", type: "tool", icon: Music, href: "/studio?tool=audio", shortcut: "3", keywords: "audio music song sound beat track voice" },
  { id: "color", label: "Color by Number", type: "tool", icon: Palette, href: "/studio?tool=color", shortcut: "4", keywords: "color coloring paint number book" },
  { id: "gallery", label: "Gallery", type: "tool", icon: LayoutGrid, href: "/studio?tool=gallery", shortcut: "8", keywords: "gallery assets library images" },
  { id: "space", label: "Space", type: "tool", icon: Rocket, href: "/studio?tool=space", shortcut: "9", keywords: "space skybox 3d world" },
];

const AGENT_ITEMS: CmdItem[] = Object.values(AGENTS).map((agent) => ({
  id: `agent-${agent.id}`,
  label: agent.name,
  type: "agent",
  icon: Bot,
  href: `/studio?tool=chat&agent=${agent.id}`,
  keywords: `${agent.id} ${agent.name} ${agent.role} ${agent.domains?.join(" ") || ""} ${agent.tag || ""}`.toLowerCase(),
}));

const ACTION_ITEMS: CmdItem[] = [
  { id: "gen-wallpaper", label: "Generate a wallpaper", type: "action", icon: Wand2, href: "/studio?tool=image&prompt=cyberpunk+wallpaper", keywords: "generate wallpaper background desktop" },
  { id: "gen-logo", label: "Generate a logo", type: "action", icon: Zap, href: "/studio?tool=image&prompt=minimal+logo", keywords: "generate logo brand icon" },
  { id: "gen-beat", label: "Generate a beat", type: "action", icon: Music, href: "/studio?tool=audio&prompt=hip+hop+beat", keywords: "generate beat music song" },
  { id: "build-landing", label: "Ask LiTTree to build a page", type: "action", icon: Code2, href: "/studio?tool=chat&prompt=build+landing+page", keywords: "build landing page website app code" },
  { id: "open-terminal", label: "Ask LiTTree to run a command", type: "action", icon: Terminal, href: "/studio?tool=chat&prompt=run+a+terminal+command", keywords: "open terminal console command shell cli" },
  { id: "play-games", label: "Play games", type: "route", icon: Command, href: "/games/cloud", keywords: "play games arcade retro" },
  { id: "admin", label: "Admin Dashboard", type: "route", icon: ShieldCheck, href: "/admin", keywords: "admin dashboard stats" },
];

const ALL_ITEMS = [...TOOL_ITEMS, ...AGENT_ITEMS, ...ACTION_ITEMS];

const GHOSTS: Record<string, string> = {
  "gen": "generate an image of...",
  "image": "generate a wallpaper",
  "build": "build a landing page...",
  "code": "build a dashboard",
  "agent": "ask LiTT CODE...",
  "term": "ask LiTTree to run...",
  "game": "play retro games",
  "help": "show all commands",
};

function getGhostText(input: string): string | null {
  const lower = input.trim().toLowerCase();
  if (!lower) return null;
  for (const [prefix, ghost] of Object.entries(GHOSTS)) {
    if (lower.startsWith(prefix)) return ghost;
  }
  return "open " + lower;
}

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
  onDesktopInspectorToggle,
  desktopInspectorOpen,
  T,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  selectedModel: string;
  onModelChange: (m: string) => void;
  onMenuToggle?: () => void;
  onInspectorToggle?: () => void;
  onDesktopInspectorToggle?: () => void;
  desktopInspectorOpen?: boolean;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { balance, isLoading: walletLoading } = useWallet();
  const [notifOpen, setNotifOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const q = search.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!q) return TOOL_ITEMS.slice(0, 6);
    return ALL_ITEMS.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.includes(q) ||
      item.id.includes(q),
    ).slice(0, 8);
  }, [q]);

  const ghost = useMemo(() => getGhostText(search), [search]);

  const runItem = (item: CmdItem) => {
    if (!item.href) return;
    setOpen(false);
    onSearchChange("");
    router.push(item.href, { scroll: false });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, suggestions.length - 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = suggestions[highlighted];
      if (item) runItem(item);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "/" && !search) {
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    }
  };

  useEffect(() => {
    setHighlighted(0);
  }, [search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <header
      className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-4"
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
        ref={wrapperRef}
        className="relative flex-1 max-w-lg min-w-0"
        style={{ color: T.textMuted }}
      >
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10"
        />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search tools, agents, projects…"
          className="w-full rounded-lg border pl-8 pr-16 py-2 text-[13px] outline-none transition-all focus:ring-1"
          style={{
            backgroundColor: T.bgColor + "70",
            borderColor: T.borderColor + "25",
            color: T.textColor,
            // @ts-expect-error custom css var
            "--tw-ring-color": T.accentColor + "60",
          }}
        />
        {/* Ghost text preview */}
        {ghost && (
          <span
            className="absolute left-[calc(0.75rem+14px+0.5rem)] top-1/2 -translate-y-1/2 pointer-events-none text-[13px] select-none"
            style={{ color: T.textMuted + "60" }}
          >
            {search + ghost.slice(search.length)}
          </span>
        )}
        {/* Cmd+K hint */}
        {!open && !search && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded border pointer-events-none hidden sm:block"
            style={{ borderColor: T.borderColor + "30", color: T.textMuted }}
          >
            ⌘K
          </span>
        )}
        {search && (
          <button
            onClick={() => { onSearchChange(""); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={11} />
          </button>
        )}

        {/* Command palette dropdown */}
        {open && (
          <div
            className="absolute left-0 right-0 top-full mt-1.5 rounded-xl border overflow-hidden shadow-2xl z-50"
            style={{
              backgroundColor: T.boxBg,
              borderColor: T.borderColor + "30",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="px-3 py-2 border-b text-[9px] font-black uppercase tracking-widest flex items-center justify-between"
              style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
            >
              <span>Command Palette</span>
              <span>{suggestions.length} results</span>
            </div>
            <div className="max-h-[320px] overflow-y-auto py-1">
              {suggestions.length === 0 && (
                <div className="px-3 py-6 text-center text-[11px]" style={{ color: T.textMuted }}>
                  No matches. Try a tool name or type &quot;help&quot;.
                </div>
              )}
              {suggestions.map((item, i) => {
                const Icon = item.icon;
                const active = i === highlighted;
                return (
                  <button
                    key={item.id}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => runItem(item)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                    style={{
                      backgroundColor: active ? T.accentColor + "15" : "transparent",
                    }}
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: active ? T.accentColor + "25" : T.bgColor + "60",
                        color: active ? T.accentColor : T.textMuted,
                      }}
                    >
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold truncate" style={{ color: active ? T.textColor : T.textColor }}>
                        {item.label}
                      </div>
                      <div className="text-[9px] capitalize" style={{ color: T.textMuted }}>
                        {item.type} {item.shortcut && `· shortcut ${item.shortcut}`}
                      </div>
                    </div>
                    {active && (
                      <ArrowRight size={12} style={{ color: T.accentColor }} />
                    )}
                  </button>
                );
              })}
            </div>
            <div
              className="px-3 py-2 border-t text-[9px] flex items-center justify-between"
              style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
            >
              <span>↑↓ navigate · Enter run · Esc close</span>
              <span className="hidden sm:inline">⌘K to open</span>
            </div>
          </div>
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
          className="relative rounded-lg p-2 transition-all hover:bg-white/10"
          style={{ color: notifOpen ? T.accentColor : T.textMuted }}
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell size={15} />
          <span
            className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full border border-[#08080c]"
            style={{ backgroundColor: "#ff3a3a", boxShadow: "0 0 6px #ff3a3a" }}
          >
            <span className="h-1 w-1 rounded-full bg-white" />
          </span>
        </button>
        {notifOpen && <NotifPanel onClose={() => setNotifOpen(false)} T={T} />}
      </div>

      <Link
        href="/settings"
        className="rounded-lg p-2 transition-all hover:bg-white/10"
        style={{ color: T.textMuted }}
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={14} />
      </Link>
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
      {onDesktopInspectorToggle && (
        <button
          onClick={onDesktopInspectorToggle}
          className="hidden md:flex rounded-lg p-2 transition-all hover:bg-white/10"
          style={{ color: desktopInspectorOpen ? T.accentColor : T.textMuted }}
          aria-label={desktopInspectorOpen ? "Hide inspector" : "Show inspector"}
          title={desktopInspectorOpen ? "Hide inspector" : "Show inspector"}
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
      <span style={{ color: T.success }}>Live</span>
      <span className="opacity-50 text-[9px] uppercase tracking-wider">
        Studio
      </span>
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
      <div className="fixed inset-0 z-[100]" onClick={onClose} aria-hidden />
      <div
        className="fixed right-3 sm:right-4 top-14 w-80 rounded-2xl border p-3 shadow-2xl z-[110]"
        style={{
          backgroundColor: T.boxBg,
          borderColor: T.borderColor + "30",
          boxShadow: `0 20px 60px rgba(0,0,0,0.6)`,
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
