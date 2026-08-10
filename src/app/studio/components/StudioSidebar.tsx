"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  Image as ImageIcon,
  Film,
  Music,
  Palette,
  Bot,
  Rocket,
  Sprout,
  Terminal,
  Hammer,
  Network,
  Shell,
  Code,
  FolderOpen,
  MessageSquare,
  Puzzle,
  Camera,
  MonitorUp,
  MoreHorizontal,
  X,
  Settings as SettingsIcon,
  User,
  Plug,
  Bell,
  Mic,
  Cpu,
  Shield,
  Sparkles,
  Layout,
  Repeat,
} from "lucide-react";

export type StudioTool =
  | "home"
  | "chat"
  | "canvas"
  | "design"
  | "image"
  | "video"
  | "audio"
  | "music"
  | "build"
  | "code"
  | "agents"
  | "assets"
  | "plugins"
  | "camera"
  | "screen"
  | "terminal"
  | "workflows"
  | "space"
  | "clibridge"
  | "loops"
  | "preview";

type ToolItem = {
  id: StudioTool;
  label: string;
  icon: typeof ImageIcon;
  shortcut: string;
};

/* ── Primary rail tools (always visible) ─────────────────────────── */
const PRIMARY_TOOLS: ToolItem[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, shortcut: "C" },
  { id: "canvas", label: "Canvas", icon: Layout, shortcut: "V" },
  { id: "design", label: "Design", icon: Palette, shortcut: "D" },
  { id: "code", label: "Code", icon: Code, shortcut: "K" },
  { id: "build", label: "Build", icon: Hammer, shortcut: "B" },
  { id: "image", label: "Image", icon: ImageIcon, shortcut: "1" },
  { id: "video", label: "Video", icon: Film, shortcut: "2" },
  { id: "audio", label: "Audio", icon: Music, shortcut: "3" },
  { id: "music", label: "Music", icon: Music, shortcut: "4" },
  { id: "agents", label: "AI Team", icon: Bot, shortcut: "5" },
  { id: "workflows", label: "Missions", icon: Network, shortcut: "7" },
  { id: "assets", label: "Assets", icon: FolderOpen, shortcut: "8" },
];

/* ── Secondary tools (in More Tools drawer) ──────────────────────── */
const MORE_TOOLS: ToolItem[] = [
  { id: "plugins", label: "Plugins", icon: Puzzle, shortcut: "P" },
  { id: "clibridge", label: "CLI Bridge", icon: Shell, shortcut: "0" },
  { id: "loops", label: "Loops", icon: Repeat, shortcut: "L" },
];

const ALL_TOOLS = [...PRIMARY_TOOLS, ...MORE_TOOLS];
const MOBILE_PRIMARY: StudioTool[] = ["chat", "canvas", "image", "workflows", "agents"];

/* ── Desktop Tool Rail (72px, expands on hover) ──────────────────── */
function RailButton({
  tool,
  active,
  onClick,
  T,
}: {
  tool: ToolItem;
  active: boolean;
  onClick: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 hover:bg-white/8 ${active ? "glass-active" : ""}`}
      style={{
        color: active ? "var(--purple)" : "rgba(255,255,255,0.5)",
        backgroundColor: active ? "var(--purple-soft)" : "transparent",
      }}
      title={tool.label}
      aria-label={tool.label}
    >
      {active && (
        <span
          className="absolute -left-1 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r-full"
          style={{
            backgroundColor: "var(--purple)",
            boxShadow: "0 0 8px var(--purple)",
          }}
        />
      )}
      <Icon
        size={18}
        strokeWidth={active ? 2.2 : 1.7}
        style={active ? { filter: "drop-shadow(0 0 4px rgba(139,92,246,0.4))" } : undefined}
        className="pointer-events-none transition-transform duration-200 group-hover:scale-110"
      />
      {/* Tooltip label on hover */}
      <span
        className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-bold opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-50"
        style={{
          backgroundColor: "#0d0f17",
          borderColor: "rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.85)",
        }}
      >
        {tool.label}
      </span>
    </button>
  );
}

/* ── Main export ─────────────────────────────────────────────────── */
export default function StudioSidebar({
  activeTool,
  onToolChange,
  projectReady: _projectReady = true,
}: {
  activeTool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
  search?: string;
  projectReady?: boolean;
}) {
  const { resolvedColors: T } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP Tool Rail — 72px icon-only, hidden on mobile
      ═══════════════════════════════════════════════════════════ */}
      <aside
        className="glass-shell hidden md:flex h-full w-16 shrink-0 flex-col items-center border-r py-2"
        style={{
          backgroundColor: "var(--glass-1)",
          borderRight: "1px solid var(--border-soft)",
        }}
      >
        {/* Logo */}
        <div className="mb-2 flex h-10 w-10 items-center justify-center">
          <button
            type="button"
            onClick={() => onToolChange("home")}
            className="grid h-9 w-9 place-items-center rounded-xl border"
            style={{
              color: T.accentColor,
              borderColor: `${T.accentColor}40`,
              backgroundColor: `${T.accentColor}10`,
            }}
            aria-label="Studio home"
            title="Studio home"
          >
            <Sprout size={18} className="pointer-events-none" />
          </button>
        </div>

        {/* Primary tools */}
        <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
          {PRIMARY_TOOLS.map((tool) => (
            <RailButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              onClick={() => onToolChange(tool.id)}
              T={T}
            />
          ))}

          {/* Divider */}
          <div
            className="my-1.5 h-px w-8"
            style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
          />

          {/* More Tools button */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all hover:bg-white/8"
            style={{
              color: moreOpen ? T.accentColor : "rgba(255,255,255,0.5)",
              backgroundColor: moreOpen ? `${T.accentColor}15` : "transparent",
            }}
            title="More Tools"
            aria-label="More Tools"
          >
            <MoreHorizontal size={18} strokeWidth={1.7} className="pointer-events-none" />
            <span
              className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-bold opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-50"
              style={{
                backgroundColor: "#0d0f17",
                borderColor: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.85)",
              }}
            >
              More Tools
            </span>
          </button>
        </div>

        {/* Bottom status dot */}
        <div className="flex h-8 items-center justify-center">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: T.success,
              boxShadow: `0 0 6px ${T.success}`,
            }}
            aria-label="System status: active"
            role="img"
          />
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════
          More Tools drawer (desktop) — slides out from rail
      ═══════════════════════════════════════════════════════════ */}
      {moreOpen && (
        <div
          className="fixed left-16 top-0 z-50 hidden h-full w-55 flex-col border-r md:flex"
          style={{
            backgroundColor: "rgba(10,12,18,0.98)",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "8px 0 32px rgba(0,0,0,0.4)",
          }}
        >
          <div
            className="flex h-12 items-center justify-between px-4"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
              More Tools
            </span>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white/80"
              aria-label="Close more tools"
            >
              <X size={14} className="pointer-events-none" />
            </button>
          </div>
          <div className="flex flex-col gap-1 p-2">
            {MORE_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    onToolChange(tool.id);
                    setMoreOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all hover:bg-white/5"
                  style={{
                    color: active ? T.accentColor : "rgba(255,255,255,0.6)",
                    backgroundColor: active ? `${T.accentColor}12` : "transparent",
                  }}
                >
                  <Icon size={18} strokeWidth={active ? 2.2 : 1.7} className="pointer-events-none" />
                  <span className="text-xs font-bold">{tool.label}</span>
                </button>
              );
            })}

            {/* Divider */}
            <div
              className="my-1 h-px"
              style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
            />
          </div>
        </div>
      )}
    </>
  );
}

/* ── More sheet entry types ─────────────────────────────────────── */
type SheetEntry = {
  label: string;
  description?: string;
  icon: typeof ImageIcon;
  href?: string;
  tool?: StudioTool;
};

const PRIMARY_ENTRIES: SheetEntry[] = [
  { label: "Settings", description: "Manage Studio, models, voice, camera, appearance, and connections", icon: SettingsIcon, href: "/settings" },
  { label: "Account", description: "Profile, plan, usage, and security", icon: User, href: "/profile" },
  { label: "Connections", description: "GitHub, Vercel, Supabase, and model providers", icon: Plug, href: "/settings/connections" },
];

const SYSTEM_ENTRIES: SheetEntry[] = [
  { label: "Notifications", icon: Bell, href: "/settings" },
  { label: "Appearance", icon: Palette, href: "/settings" },
  { label: "Voice & Camera", icon: Mic, href: "/settings/agents/voice" },
  { label: "AI & Models", icon: Cpu, href: "/settings" },
  { label: "Privacy & Security", icon: Shield, href: "/settings" },
  { label: "Billing & Credits", icon: Sparkles, href: "/settings" },
];

/* ── Mobile bottom tab bar ───────────────────────────────────────── */
export function MobileTabBar({
  activeTool,
  onToolChange,
  T,
}: {
  activeTool: StudioTool;
  onToolChange: (t: StudioTool) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const primaryTools = ALL_TOOLS.filter((t) => MOBILE_PRIMARY.includes(t.id));
  const secondaryTools = ALL_TOOLS.filter(
    (t) => !MOBILE_PRIMARY.includes(t.id),
  );
  const activeIsSecondary = secondaryTools.some((t) => t.id === activeTool);

  // Close on Escape + focus trap
  useEffect(() => {
    if (!drawerOpen) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    // Focus first focusable element on open
    const focusables = sheet.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusables[0]?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (e.key === "Tab" && focusables.length > 0) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawerOpen]);

  const returnTo = typeof window !== "undefined" ? encodeURIComponent(window.location.pathname + window.location.search) : "/studio";

  const renderEntry = (entry: SheetEntry, key: string) => {
    const Icon = entry.icon;
    const href = entry.href ? `${entry.href}${entry.href.includes("?") ? "&" : "?"}returnTo=${returnTo}` : undefined;
    if (href) {
      return (
        <Link
          key={key}
          href={href}
          onClick={() => setDrawerOpen(false)}
          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 transition-all hover:bg-white/5"
          aria-label={entry.label}
        >
          <Icon size={18} className="pointer-events-none shrink-0" style={{ color: T.accentColor }} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>{entry.label}</div>
            {entry.description && (
              <div className="text-[10px] leading-tight" style={{ color: "rgba(255,255,255,0.65)" }}>{entry.description}</div>
            )}
          </div>
        </Link>
      );
    }
    return null;
  };

  return (
    <>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-10030 md:hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {drawerOpen && (
        <div
          ref={sheetRef}
          className="fixed bottom-[calc(56px+env(safe-area-inset-bottom))] left-0 right-0 z-10030 max-h-[min(70dvh,560px)] overflow-y-auto rounded-t-2xl border-t px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden"
          style={{
            backgroundColor: "#08090d",
            borderColor: "rgba(255,255,255,0.08)",
            boxShadow: `0 -8px 32px rgba(0,0,0,0.5)`,
          }}
        >
          {/* Drag handle */}
          <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.15)" }} />

          {/* PRIMARY section */}
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-white/65">Primary</div>
          <div className="mb-3 space-y-1">
            {PRIMARY_ENTRIES.map((entry) => renderEntry(entry, `primary-${entry.label}`))}
          </div>

          {/* TOOLS section */}
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-white/65">Tools</div>
          <div className="mb-3 grid grid-cols-4 gap-2">
            {secondaryTools.map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    onToolChange(tool.id);
                    setDrawerOpen(false);
                  }}
                  className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl transition-all"
                  style={{
                    backgroundColor: active ? `${T.accentColor}20` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${active ? `${T.accentColor}50` : "rgba(255,255,255,0.06)"}`,
                  }}
                  aria-label={tool.label}
                  title={tool.label}
                >
                  <Icon
                    size={18}
                    strokeWidth={active ? 2.5 : 1.8}
                    style={{ color: active ? T.accentColor : "rgba(255,255,255,0.5)" }}
                  />
                  <span className="text-[9px] font-bold" style={{ color: active ? T.accentColor : "rgba(255,255,255,0.65)" }}>
                    {tool.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* SYSTEM section */}
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-white/65">System</div>
          <div className="space-y-1">
            {SYSTEM_ENTRIES.map((entry) => renderEntry(entry, `system-${entry.label}`))}
          </div>
        </div>
      )}

      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex h-[calc(56px+env(safe-area-inset-bottom))] items-stretch pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{
          backgroundColor: "rgba(8,9,13,0.98)",
          backdropFilter: "blur(20px) saturate(180%)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {primaryTools.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => {
                onToolChange(tool.id);
                setDrawerOpen(false);
              }}
              className="flex-1 flex min-h-11 flex-col items-center justify-center gap-0.5 transition-all relative"
              style={{ color: active ? T.accentColor : "rgba(255,255,255,0.65)" }}
              aria-label={tool.label}
              title={tool.label}
            >
              {active && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full"
                  style={{ backgroundColor: T.accentColor }}
                />
              )}
              <Icon size={19} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[9px] font-bold">{tool.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          className="flex-1 flex min-h-11 flex-col items-center justify-center gap-0.5 transition-all relative"
          style={{ color: activeIsSecondary ? T.accentColor : "rgba(255,255,255,0.65)" }}
          aria-label="More"
          title="More"
        >
          {activeIsSecondary && (
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full"
              style={{ backgroundColor: T.accentColor }}
            />
          )}
          <MoreHorizontal size={19} strokeWidth={activeIsSecondary ? 2.5 : 1.8} />
          <span className="text-[9px] font-bold">More</span>
        </button>
      </div>
    </>
  );
}
