"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Image as ImageIcon,
  Film,
  Music,
  Palette,
  Bot,
  Rocket,
  Sparkles,
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
} from "lucide-react";

export type StudioTool =
  | "home"
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "build"
  | "code"
  | "agents"
  | "assets"
  | "plugins"
  | "camera"
  | "screen"
  | "terminal"
  | "pipeline"
  | "space"
  | "clibridge"
  | "color";

type ToolItem = {
  id: StudioTool;
  label: string;
  icon: typeof ImageIcon;
  shortcut: string;
};

/* ── Primary rail tools (always visible) ─────────────────────────── */
const PRIMARY_TOOLS: ToolItem[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, shortcut: "C" },
  { id: "image", label: "Image", icon: ImageIcon, shortcut: "1" },
  { id: "video", label: "Video", icon: Film, shortcut: "2" },
  { id: "audio", label: "Audio", icon: Music, shortcut: "3" },
  { id: "build", label: "Build", icon: Hammer, shortcut: "B" },
  { id: "code", label: "Code", icon: Code, shortcut: "K" },
  { id: "agents", label: "Agents", icon: Bot, shortcut: "5" },
  { id: "terminal", label: "Terminal", icon: Terminal, shortcut: "6" },
  { id: "assets", label: "Assets", icon: FolderOpen, shortcut: "8" },
  { id: "plugins", label: "Plugins", icon: Puzzle, shortcut: "P" },
  { id: "camera", label: "Camera", icon: Camera, shortcut: "M" },
];

/* ── Secondary tools (in More Tools drawer) ──────────────────────── */
const MORE_TOOLS: ToolItem[] = [
  { id: "screen", label: "Screen", icon: MonitorUp, shortcut: "S" },
  { id: "color", label: "Color", icon: Palette, shortcut: "4" },
  { id: "space", label: "Space", icon: Rocket, shortcut: "9" },
  { id: "pipeline", label: "Workflow Forge", icon: Network, shortcut: "7" },
  { id: "clibridge", label: "CLI Bridge", icon: Shell, shortcut: "0" },
];

const ALL_TOOLS = [...PRIMARY_TOOLS, ...MORE_TOOLS];
const MOBILE_PRIMARY: StudioTool[] = ["chat", "image", "code", "agents"];

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
      className="group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 hover:bg-white/8"
      style={{
        color: active ? T.accentColor : "rgba(255,255,255,0.5)",
        backgroundColor: active ? `${T.accentColor}15` : "transparent",
      }}
      title={tool.label}
      aria-label={tool.label}
    >
      {active && (
        <span
          className="absolute -left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
          style={{
            backgroundColor: T.accentColor,
            boxShadow: `0 0 8px ${T.accentColor}`,
          }}
        />
      )}
      <Icon
        size={20}
        strokeWidth={active ? 2.2 : 1.7}
        style={active ? { filter: `drop-shadow(0 0 4px ${T.accentColor}60)` } : undefined}
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
}: {
  activeTool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
  search?: string;
}) {
  const { resolvedColors: T } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP Tool Rail — 72px icon-only, hidden on mobile
      ═══════════════════════════════════════════════════════════ */}
      <aside
        className="hidden md:flex h-full w-[72px] shrink-0 flex-col items-center border-r py-2"
        style={{
          backgroundColor: "rgba(8,9,13,0.96)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Logo */}
        <div className="mb-2 flex h-10 w-10 items-center justify-center">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl border"
            style={{
              color: T.accentColor,
              borderColor: `${T.accentColor}40`,
              backgroundColor: `${T.accentColor}10`,
            }}
          >
            <Sparkles size={16} className="pointer-events-none" />
          </span>
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
            className="group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all hover:bg-white/8"
            style={{
              color: moreOpen ? T.accentColor : "rgba(255,255,255,0.5)",
              backgroundColor: moreOpen ? `${T.accentColor}15` : "transparent",
            }}
            title="More Tools"
            aria-label="More Tools"
          >
            <MoreHorizontal size={20} strokeWidth={1.7} className="pointer-events-none" />
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
            aria-hidden
          />
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════
          More Tools drawer (desktop) — slides out from rail
      ═══════════════════════════════════════════════════════════ */}
      {moreOpen && (
        <div
          className="fixed left-[72px] top-0 z-50 hidden h-full w-[220px] flex-col border-r md:flex"
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
              className="grid h-8 w-8 place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white/80"
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
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MOBILE bottom tab bar — visible only below md
      ═══════════════════════════════════════════════════════════ */}
      <MobileTabBar activeTool={activeTool} onToolChange={onToolChange} T={T} />
    </>
  );
}

/* ── Mobile bottom tab bar ───────────────────────────────────────── */
function MobileTabBar({
  activeTool,
  onToolChange,
  T,
}: {
  activeTool: StudioTool;
  onToolChange: (t: StudioTool) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const primaryTools = ALL_TOOLS.filter((t) => MOBILE_PRIMARY.includes(t.id));
  const secondaryTools = ALL_TOOLS.filter(
    (t) => !MOBILE_PRIMARY.includes(t.id),
  );
  const activeIsSecondary = secondaryTools.some((t) => t.id === activeTool);

  return (
    <>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[10000] md:hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {drawerOpen && (
        <div
          className="fixed bottom-[calc(56px+env(safe-area-inset-bottom))] left-0 right-0 z-[10000] max-h-[min(58dvh,480px)] overflow-y-auto rounded-t-2xl border-t px-3 pt-3 pb-2 md:hidden"
          style={{
            backgroundColor: "#08090d",
            borderColor: "rgba(255,255,255,0.08)",
            boxShadow: `0 -8px 32px rgba(0,0,0,0.5)`,
          }}
        >
          <div className="mb-2 text-[9px] font-bold uppercase tracking-widest opacity-50 text-white/60">
            More Tools
          </div>
          <div className="grid grid-cols-4 gap-2">
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
                  className="flex flex-col items-center gap-1 py-2 rounded-xl transition-all"
                  style={{
                    backgroundColor: active ? `${T.accentColor}20` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${active ? `${T.accentColor}50` : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <Icon
                    size={18}
                    strokeWidth={active ? 2.5 : 1.8}
                    style={{ color: active ? T.accentColor : "rgba(255,255,255,0.5)" }}
                  />
                  <span className="text-[9px] font-bold" style={{ color: active ? T.accentColor : "rgba(255,255,255,0.4)" }}>
                    {tool.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        className="fixed bottom-0 left-0 right-0 z-[10000] flex h-[calc(56px+env(safe-area-inset-bottom))] items-stretch pb-[env(safe-area-inset-bottom)] md:hidden"
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
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all relative"
              style={{ color: active ? T.accentColor : "rgba(255,255,255,0.4)" }}
            >
              {active && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full"
                  style={{ backgroundColor: T.accentColor, boxShadow: `0 0 8px ${T.accentColor}` }}
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
          className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all relative"
          style={{ color: activeIsSecondary ? T.accentColor : "rgba(255,255,255,0.4)" }}
        >
          {activeIsSecondary && (
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full"
              style={{ backgroundColor: T.accentColor, boxShadow: `0 0 8px ${T.accentColor}` }}
            />
          )}
          <div className="flex gap-[3px] items-center">
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: "currentColor" }} />
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: "currentColor" }} />
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: "currentColor" }} />
          </div>
          <span className="text-[9px] font-bold">More</span>
        </button>
      </div>
    </>
  );
}
