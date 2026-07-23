"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Image,
  Film,
  Music,
  Palette,
  Bot,
  Rocket,
  ChevronLeft,
  ChevronRight,
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
  icon: typeof Image;
  shortcut: string;
};

/* ── Tool groups — Creator Rail layout ──────────────────────────── */
const CREATE_TOOLS: ToolItem[] = [
  { id: "home", label: "Home", icon: Bot, shortcut: "H" },
  { id: "chat", label: "Chat", icon: MessageSquare, shortcut: "C" },
  { id: "image", label: "Image", icon: Image, shortcut: "1" },
  { id: "video", label: "Video", icon: Film, shortcut: "2" },
  { id: "audio", label: "Audio", icon: Music, shortcut: "3" },
  { id: "build", label: "Build", icon: Hammer, shortcut: "B" },
  { id: "code", label: "Code", icon: Code, shortcut: "K" },
];

const AI_TOOLS: ToolItem[] = [
  { id: "agents", label: "Agents", icon: Bot, shortcut: "5" },
  { id: "terminal", label: "Terminal", icon: Terminal, shortcut: "6" },
  { id: "pipeline", label: "Pipeline", icon: Network, shortcut: "7" },
  { id: "clibridge", label: "CLI Bridge", icon: Shell, shortcut: "0" },
];

const ORGANIZE_TOOLS: ToolItem[] = [
  { id: "assets", label: "Assets", icon: FolderOpen, shortcut: "8" },
  { id: "plugins", label: "Plugins", icon: Puzzle, shortcut: "P" },
  { id: "camera", label: "Camera", icon: Camera, shortcut: "M" },
  { id: "screen", label: "Screen", icon: MonitorUp, shortcut: "S" },
  { id: "color", label: "Color", icon: Palette, shortcut: "4" },
  { id: "space", label: "Space", icon: Rocket, shortcut: "9" },
];

/* All tools flat — used for mobile bottom bar */
const ALL_TOOLS: ToolItem[] = [...CREATE_TOOLS, ...AI_TOOLS, ...ORGANIZE_TOOLS];

/* Primary 5 shown in mobile bottom bar — Chat, Image, Assets, Agents, More */
const MOBILE_PRIMARY: StudioTool[] = ["chat", "image", "assets", "agents"];

type GroupDef = { title: string; tools: ToolItem[] };
const GROUPS: GroupDef[] = [
  { title: "Create", tools: CREATE_TOOLS },
  { title: "AI", tools: AI_TOOLS },
  { title: "Assets", tools: ORGANIZE_TOOLS },
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
      aria-label={tool.label}
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
          <span
            className="flex-1 text-left text-[11px] font-bold tracking-wide"
            style={{ color: active ? T.accentColor : T.textColor }}
          >
            {tool.label}
          </span>
          <kbd
            className="text-[9px] px-1 py-px rounded font-mono"
            style={{ backgroundColor: T.bgColor + "60", color: T.textMuted }}
          >
            {tool.shortcut}
          </kbd>
        </>
      )}
    </button>
  );
}

/* ── Mode config panel (inline controls for active creation mode) ── */
function ModeConfigPanel({
  activeTool,
  T,
}: {
  activeTool: StudioTool;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (activeTool === "image") {
    return (
      <div
        className="px-3 py-3 space-y-2.5"
        style={{ borderTop: `1px solid ${T.borderColor}15` }}
      >
        <div
          className="text-[9px] font-black uppercase tracking-[0.2em]"
          style={{ color: T.accentColor }}
        >
          Image
        </div>
        <ConfigField label="Prompt" placeholder="Describe the image…" T={T} />
        <ConfigSelect
          label="Model"
          options={["Flux 1.1 Pro", "DALL·E 3", "SDXL"]}
          T={T}
        />
        <ConfigSelect
          label="Aspect"
          options={["1:1", "16:9", "9:16", "4:3"]}
          T={T}
        />
        <ConfigSelect
          label="Style"
          options={["Auto", "Photoreal", "Anime", "3D Render", "Cinematic"]}
          T={T}
        />
        <ConfigSelect
          label="Quality"
          options={["Draft", "Standard", "High"]}
          T={T}
        />
        <button
          className="w-full py-2 rounded-lg text-[11px] font-black transition-all hover:opacity-90"
          style={{ background: T.accentColor, color: "#000" }}
        >
          Generate
        </button>
      </div>
    );
  }

  if (activeTool === "video") {
    return (
      <div
        className="px-3 py-3 space-y-2.5"
        style={{ borderTop: `1px solid ${T.borderColor}15` }}
      >
        <div
          className="text-[9px] font-black uppercase tracking-[0.2em]"
          style={{ color: T.accentColor }}
        >
          Video
        </div>
        <ConfigField
          label="Scene prompt"
          placeholder="Describe the scene…"
          T={T}
        />
        <ConfigSelect
          label="Model"
          options={["Kling 1.6 Pro", "Runway Gen-3", "Pika 2.0"]}
          T={T}
        />
        <ConfigSelect label="Duration" options={["4s", "6s", "10s"]} T={T} />
        <ConfigSelect
          label="Motion"
          options={["Low", "Medium", "High"]}
          T={T}
        />
        <ConfigSelect
          label="Camera"
          options={["Static", "Dolly in", "Pan left", "Zoom"]}
          T={T}
        />
        <button
          className="w-full py-2 rounded-lg text-[11px] font-black transition-all hover:opacity-90"
          style={{ background: T.accentColor, color: "#000" }}
        >
          Generate
        </button>
      </div>
    );
  }

  if (activeTool === "audio") {
    return (
      <div
        className="px-3 py-3 space-y-2.5"
        style={{ borderTop: `1px solid ${T.borderColor}15` }}
      >
        <div
          className="text-[9px] font-black uppercase tracking-[0.2em]"
          style={{ color: T.accentColor }}
        >
          Audio
        </div>
        <ConfigField label="Prompt" placeholder="Describe the music…" T={T} />
        <ConfigSelect
          label="Mode"
          options={["Music", "Text-to-speech"]}
          T={T}
        />
        <ConfigSelect
          label="Genre"
          options={["Auto", "Cinematic", "EDM", "Lo-fi", "Orchestral"]}
          T={T}
        />
        <ConfigSelect
          label="Duration"
          options={["30s", "1:00", "3:00", "Full"]}
          T={T}
        />
        <ConfigSelect
          label="Model"
          options={["MiniMax Music", "Bark", "MusicGen"]}
          T={T}
        />
        <button
          className="w-full py-2 rounded-lg text-[11px] font-black transition-all hover:opacity-90"
          style={{ background: T.accentColor, color: "#000" }}
        >
          Generate
        </button>
      </div>
    );
  }

  // For non-creation modes, show a compact project switcher
  return (
    <div
      className="px-3 py-3 space-y-2"
      style={{ borderTop: `1px solid ${T.borderColor}15` }}
    >
      <div
        className="text-[9px] font-black uppercase tracking-[0.2em]"
        style={{ color: T.textMuted }}
      >
        Project
      </div>
      <div
        className="rounded-lg px-2.5 py-2 cursor-pointer transition-colors hover:bg-white/5"
        style={{
          background: T.bgColor + "50",
          border: `1px solid ${T.borderColor}20`,
        }}
      >
        <div
          className="text-[11px] font-bold truncate"
          style={{ color: T.textColor }}
        >
          litlabs-website
        </div>
        <div
          className="text-[9px] font-mono mt-0.5"
          style={{ color: T.accentColor }}
        >
          feature/landing
        </div>
      </div>
      <button
        onClick={() => setAdvancedOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[10px] font-bold py-1 transition-colors hover:bg-white/5 rounded px-1"
        style={{ color: T.textMuted }}
      >
        Advanced
        <ChevronRight
          size={10}
          className={
            "transition-transform " + (advancedOpen ? "rotate-90" : "")
          }
        />
      </button>
      {advancedOpen && (
        <div className="space-y-1 pl-1">
          {[
            { label: "Model", value: "Gemini 2.5" },
            { label: "Context", value: "1M tokens" },
            { label: "Memory", value: "Active" },
          ].map((r) => (
            <div
              key={r.label}
              className="flex justify-between text-[10px] py-0.5"
            >
              <span style={{ color: T.textMuted }}>{r.label}</span>
              <span style={{ color: T.textColor }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigField({
  label,
  placeholder,
  T,
}: {
  label: string;
  placeholder: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div>
      <div className="text-[9px] font-bold mb-1" style={{ color: T.textMuted }}>
        {label}
      </div>
      <input
        type="text"
        placeholder={placeholder}
        className="w-full rounded-md px-2 py-1.5 text-[10px] outline-none transition-colors focus:border-[var(--accent)]"
        style={{
          background: T.bgColor + "60",
          border: `1px solid ${T.borderColor}25`,
          color: T.textColor,
        }}
      />
    </div>
  );
}

function ConfigSelect({
  label,
  options,
  T,
}: {
  label: string;
  options: string[];
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div>
      <div className="text-[9px] font-bold mb-1" style={{ color: T.textMuted }}>
        {label}
      </div>
      <select
        className="w-full rounded-md px-2 py-1.5 text-[10px] outline-none cursor-pointer transition-colors"
        style={{
          background: T.bgColor + "60",
          border: `1px solid ${T.borderColor}25`,
          color: T.textColor,
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────────── */
export default function StudioSidebar({
  activeTool,
  onToolChange,
  search = "",
}: {
  activeTool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
  search?: string;
}) {
  const { resolvedColors: T } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const query = search.trim().toLowerCase();

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP sidebar — hidden on mobile (md+)
      ═══════════════════════════════════════════════════════════ */}
      <aside
        className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-out"
        style={{
          width: collapsed ? "60px" : "240px",
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
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Grouped nav */}
        <nav className="flex-1 py-2 overflow-y-auto space-y-1">
          {GROUPS.map((group) => {
            const visibleTools = query
              ? group.tools.filter(
                  (tool) =>
                    tool.label.toLowerCase().includes(query) ||
                    tool.id.toLowerCase().includes(query),
                )
              : group.tools;
            if (visibleTools.length === 0) return null;
            return (
              <div key={group.title} className="mb-1">
                {!collapsed && (
                  <div
                    className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.2em]"
                    style={{ color: T.textColor, opacity: 0.65 }}
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
                  {visibleTools.map((tool) => (
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
            );
          })}
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
                aria-hidden
              />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span
                className="text-[11px] font-mono"
                style={{ color: T.textColor, opacity: 0.7 }}
              >
                v1.0
              </span>
              <span
                className="flex items-center gap-1.5 text-[11px] font-mono"
                style={{ color: T.textColor, opacity: 0.85 }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor: T.success,
                    boxShadow: `0 0 4px ${T.success}`,
                  }}
                  aria-hidden
                />
                Studio ready
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
          className="fixed inset-0 z-[10000] md:hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Secondary tools drawer — slides up above tab bar */}
      {drawerOpen && (
        <div
          className="fixed bottom-[calc(56px+env(safe-area-inset-bottom))] left-0 right-0 z-[10000] max-h-[min(58dvh,480px)] overflow-y-auto rounded-t-2xl border-t px-3 pt-3 pb-2 md:hidden"
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
        className="fixed bottom-0 left-0 right-0 z-[10000] flex h-[calc(56px+env(safe-area-inset-bottom))] items-stretch pb-[env(safe-area-inset-bottom)] md:hidden"
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
              style={{ color: active ? T.accentColor : T.textMuted }}
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
              <span className="text-[9px] font-bold">
                {tool.label}
              </span>
            </button>
          );
        })}

        {/* More button */}
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all relative"
          style={{
            color: activeIsSecondary ? T.accentColor : T.textMuted,
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
