"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Image,
  Film,
  Music,
  Palette,
  LayoutGrid,
  Bot,
  MessageCircle,
  Rocket,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Terminal,
  Hammer,
  Network,
  Shell,
} from "lucide-react";

export type StudioTool =
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "agents"
  | "terminal"
  | "builder"
  | "pipeline"
  | "gallery"
  | "space"
  | "clibridge"
  | "color"
  | "canvas";

type ToolItem = {
  id: StudioTool;
  label: string;
  icon: typeof Image;
  shortcut: string;
};

/* ── Tool groups ─────────────────────────────────────────────────── */
const CREATE_TOOLS: ToolItem[] = [
  { id: "image", label: "Image", icon: Image, shortcut: "1" },
  { id: "video", label: "Video", icon: Film, shortcut: "2" },
  { id: "audio", label: "Audio", icon: Music, shortcut: "3" },
  { id: "color", label: "Color", icon: Palette, shortcut: "4" },
];

const AI_TOOLS: ToolItem[] = [
  { id: "chat", label: "LiTT Chat", icon: MessageCircle, shortcut: "C" },
  { id: "builder", label: "Builder", icon: Hammer, shortcut: "B" },
  { id: "agents", label: "Agents", icon: Bot, shortcut: "5" },
  { id: "terminal", label: "Terminal", icon: Terminal, shortcut: "6" },
  { id: "pipeline", label: "Pipeline", icon: Network, shortcut: "7" },
  { id: "canvas", label: "Canvas", icon: Sparkles, shortcut: "9" },
  { id: "clibridge", label: "CLI Bridge", icon: Shell, shortcut: "0" },
];

const ORGANIZE_TOOLS: ToolItem[] = [
  { id: "gallery", label: "Gallery", icon: LayoutGrid, shortcut: "8" },
];

const EXTERNAL_TOOLS: ToolItem[] = [
  { id: "space", label: "Space", icon: Rocket, shortcut: "9" },
];

/* All tools flat — used for mobile bottom bar */
const ALL_TOOLS: ToolItem[] = [
  ...CREATE_TOOLS,
  ...AI_TOOLS,
  ...ORGANIZE_TOOLS,
  ...EXTERNAL_TOOLS,
];

/* Primary 5 shown in mobile bottom bar (most-used) */
const MOBILE_PRIMARY: StudioTool[] = [
  "image",
  "chat",
  "builder",
  "agents",
  "terminal",
];

type GroupDef = { title: string; tools: ToolItem[] };
const GROUPS: GroupDef[] = [
  { title: "Create", tools: CREATE_TOOLS },
  { title: "AI", tools: AI_TOOLS },
  { title: "Organize", tools: ORGANIZE_TOOLS },
  { title: "External", tools: EXTERNAL_TOOLS },
];

/* ── Desktop tool button ─────────────────────────────────────────── */
function ToolButton({
  tool,
  active,
  collapsed,
  onClick,
  T,
}: {
  tool: ToolItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const Icon = tool.icon;
  return (
    <button
      onClick={onClick}
      className={`group relative w-full flex items-center rounded-lg transition-all duration-200 ${
        collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2"
      } ${active ? "" : "hover:bg-white/5"}`}
      style={{
        color: active ? T.accentColor : T.textColor + "99",
        backgroundColor: active ? T.accentColor + "12" : "transparent",
        boxShadow: active
          ? `inset 0 0 0 1px ${T.accentColor}25, 0 0 12px ${T.accentColor}10`
          : "none",
      }}
      title={collapsed ? `${tool.label} (Ctrl+${tool.shortcut})` : undefined}
    >
      {/* Left accent bar when active */}
      {active && !collapsed && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
          style={{
            backgroundColor: T.accentColor,
            boxShadow: `0 0 8px ${T.accentColor}`,
          }}
        />
      )}
      {active && collapsed && (
        <span
          className="absolute left-1 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
          style={{
            backgroundColor: T.accentColor,
            boxShadow: `0 0 8px ${T.accentColor}`,
          }}
        />
      )}
      <Icon
        size={collapsed ? 19 : 15}
        strokeWidth={active ? 2.5 : 1.8}
        className="shrink-0 transition-transform duration-200 group-hover:scale-110"
      />
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-[11px] font-bold tracking-wide">
            {tool.label}
          </span>
          <kbd
            className="text-[9px] px-1 py-px rounded font-mono opacity-30"
            style={{ backgroundColor: T.bgColor + "60", color: T.textMuted }}
          >
            {tool.shortcut}
          </kbd>
        </>
      )}
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
}) {
  const { resolvedColors: T } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP sidebar — hidden on mobile (md+)
      ═══════════════════════════════════════════════════════════ */}
      <aside
        className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-out"
        style={{
          width: collapsed ? "60px" : "192px",
          backgroundColor: T.boxBg + "70",
          backdropFilter: "blur(20px) saturate(180%)",
          borderRight: `1px solid ${T.borderColor}18`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 h-11 shrink-0"
          style={{ borderBottom: `1px solid ${T.borderColor}12` }}
        >
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
                }}
              >
                <Sparkles size={11} className="text-white" />
              </div>
              <span
                className="text-[11px] font-black uppercase tracking-[0.15em]"
                style={{ color: T.headerColor }}
              >
                Studio
              </span>
            </div>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="p-1 rounded-md transition-all hover:bg-white/10 hover:scale-105 ml-auto"
            style={{ color: T.textMuted + "80" }}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Grouped nav */}
        <nav className="flex-1 py-2 overflow-y-auto space-y-1">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-1">
              {!collapsed && (
                <div
                  className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.2em]"
                  style={{ color: T.textMuted + "60" }}
                >
                  {group.title}
                </div>
              )}
              {collapsed && (
                <div
                  className="mx-2 my-1 h-px"
                  style={{ backgroundColor: T.borderColor + "20" }}
                />
              )}
              <div className="space-y-0.5 px-1.5">
                {group.tools.map((tool) => (
                  <ToolButton
                    key={tool.id}
                    tool={tool}
                    active={activeTool === tool.id}
                    collapsed={collapsed}
                    onClick={() => onToolChange(tool.id)}
                    T={T}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom status */}
        <div
          className="px-3 py-2.5 shrink-0"
          style={{ borderTop: `1px solid ${T.borderColor}12` }}
        >
          {collapsed ? (
            <div className="flex justify-center">
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: T.success,
                  boxShadow: `0 0 6px ${T.success}`,
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span
                className="text-[9px] font-mono opacity-40"
                style={{ color: T.textMuted }}
              >
                v1.0
              </span>
              <span
                className="flex items-center gap-1.5 text-[9px] font-mono"
                style={{ color: T.textMuted + "80" }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor: T.success,
                    boxShadow: `0 0 4px ${T.success}`,
                  }}
                />
                Online
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════
          MOBILE bottom tab bar — visible only below md
          Shows the 5 primary tools as icon+label tabs.
          "More" opens a compact drawer for the rest.
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
      {/* Scrim for secondary drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Secondary tools drawer — slides up above tab bar */}
      {drawerOpen && (
        <div
          className="fixed bottom-[56px] left-0 right-0 z-50 md:hidden rounded-t-2xl border-t px-3 pt-3 pb-2"
          style={{
            backgroundColor: T.bgColor,
            borderColor: T.borderColor + "30",
            boxShadow: `0 -8px 32px rgba(0,0,0,0.5)`,
          }}
        >
          <div
            className="text-[9px] font-bold uppercase tracking-widest mb-2 opacity-50"
            style={{ color: T.textMuted }}
          >
            More Tools
          </div>
          <div className="grid grid-cols-4 gap-2">
            {secondaryTools.map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => {
                    onToolChange(tool.id);
                    setDrawerOpen(false);
                  }}
                  className="flex flex-col items-center gap-1 py-2 rounded-xl transition-all"
                  style={{
                    backgroundColor: active
                      ? T.accentColor + "20"
                      : T.boxBg + "80",
                    border: `1px solid ${active ? T.accentColor + "50" : T.borderColor + "20"}`,
                  }}
                >
                  <Icon
                    size={18}
                    strokeWidth={active ? 2.5 : 1.8}
                    style={{
                      color: active ? T.accentColor : T.textColor + "99",
                    }}
                  />
                  <span
                    className="text-[9px] font-bold"
                    style={{ color: active ? T.accentColor : T.textMuted }}
                  >
                    {tool.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden flex items-stretch h-14"
        style={{
          backgroundColor: T.bgColor + "f5",
          backdropFilter: "blur(20px) saturate(180%)",
          borderTop: `1px solid ${T.borderColor}30`,
          boxShadow: `0 -4px 24px rgba(0,0,0,0.4)`,
        }}
      >
        {primaryTools.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => {
                onToolChange(tool.id);
                setDrawerOpen(false);
              }}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all relative"
              style={{ color: active ? T.accentColor : T.textMuted + "80" }}
            >
              {active && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full"
                  style={{
                    backgroundColor: T.accentColor,
                    boxShadow: `0 0 8px ${T.accentColor}`,
                  }}
                />
              )}
              <Icon size={19} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[9px] font-bold">{tool.label}</span>
            </button>
          );
        })}

        {/* More button */}
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all relative"
          style={{
            color: activeIsSecondary ? T.accentColor : T.textMuted + "80",
          }}
        >
          {activeIsSecondary && (
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full"
              style={{
                backgroundColor: T.accentColor,
                boxShadow: `0 0 8px ${T.accentColor}`,
              }}
            />
          )}
          <div className="flex gap-[3px] items-center">
            <span
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: "currentColor" }}
            />
            <span
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: "currentColor" }}
            />
            <span
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: "currentColor" }}
            />
          </div>
          <span className="text-[9px] font-bold">More</span>
        </button>
      </div>
    </>
  );
}
