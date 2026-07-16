"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Image,
  Film,
  Music,
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
  X,
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
  | "canvas";

type ToolItem = {
  id: StudioTool;
  label: string;
  icon: typeof Image;
  shortcut: string;
};

/* ── Tool groups — Creator Rail layout ──────────────────────────── */
const CREATE_TOOLS: ToolItem[] = [
  { id: "chat", label: "Chat", icon: Bot, shortcut: "C" },
  { id: "image", label: "Image", icon: Image, shortcut: "1" },
  { id: "video", label: "Video", icon: Film, shortcut: "2" },
  { id: "audio", label: "Audio", icon: Music, shortcut: "3" },
  { id: "builder", label: "Build", icon: Hammer, shortcut: "B" },
  { id: "canvas", label: "Code", icon: Code, shortcut: "K" },
];

const AI_TOOLS: ToolItem[] = [
  { id: "agents", label: "Agents", icon: Bot, shortcut: "5" },
  { id: "terminal", label: "Terminal", icon: Terminal, shortcut: "6" },
  { id: "pipeline", label: "Pipeline", icon: Network, shortcut: "7" },
  { id: "clibridge", label: "CLI Bridge", icon: Shell, shortcut: "0" },
];

const ORGANIZE_TOOLS: ToolItem[] = [
  { id: "gallery", label: "Assets", icon: FolderOpen, shortcut: "8" },
  { id: "space", label: "Space", icon: Rocket, shortcut: "9" },
];

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
      className={`group relative w-full flex items-center rounded-lg transition-colors duration-200 ${
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
          className="w-full py-2 rounded-lg text-[11px] font-black transition-opacity hover:opacity-90"
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
        <button
          className="w-full py-2 rounded-lg text-[11px] font-black transition-opacity hover:opacity-90"
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
          label="Model"
          options={["MiniMax Music", "Bark", "MusicGen"]}
          T={T}
        />
        <button
          className="w-full py-2 rounded-lg text-[11px] font-black transition-opacity hover:opacity-90"
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
        name="studio-sidebar-search"
        id="studio-sidebar-search"
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
        name="studio-config-select"
        id="studio-config-select"
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
  open = false,
  onClose,
}: {
  activeTool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
  search?: string;
  open?: boolean;
  onClose?: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const query = search.trim().toLowerCase();

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP sidebar — hidden on tablet/mobile (lg+)
      ═══════════════════════════════════════════════════════════ */}
      <aside
        className={`flex-col h-full shrink-0 transition-[width] duration-300 ease-out ${
          open ? "flex" : "hidden lg:flex"
        }`}
        style={{
          width: open ? "100%" : collapsed ? "60px" : "240px",
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
          {onClose ? (
            <button
              onClick={onClose}
              className="p-2 rounded-md transition-transform hover:bg-white/10 hover:scale-105 ml-auto"
              style={{ color: T.textMuted + "80" }}
              aria-label="Close menu"
              title="Close menu"
            >
              <X size={14} />
            </button>
          ) : (
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="p-2 rounded-md transition-transform hover:bg-white/10 hover:scale-105 ml-auto"
              style={{ color: T.textMuted + "80" }}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronLeft size={14} />
              )}
            </button>
          )}
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

        {/* Inline mode config panel — only when expanded */}
        {!collapsed && <ModeConfigPanel activeTool={activeTool} T={T} />}

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
                Online
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
