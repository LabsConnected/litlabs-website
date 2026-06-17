"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Image, Film, Music, LayoutGrid, Bot, Rocket,
  ChevronLeft, ChevronRight, Zap, Sparkles, Terminal, Network, Shell
} from "lucide-react";

export type StudioTool = "image" | "video" | "audio" | "agents" | "terminal" | "pipeline" | "gallery" | "space" | "clibridge";

type ToolItem = { id: StudioTool; label: string; icon: typeof Image; shortcut: string };

const CREATE_TOOLS: ToolItem[] = [
  { id: "image", label: "Image", icon: Image, shortcut: "1" },
  { id: "video", label: "Video", icon: Film, shortcut: "2" },
  { id: "audio", label: "Audio", icon: Music, shortcut: "3" },
];

const AI_TOOLS: ToolItem[] = [
  { id: "agents",   label: "Agents",   icon: Bot,     shortcut: "4" },
  { id: "terminal", label: "Terminal", icon: Terminal, shortcut: "5" },
  { id: "pipeline", label: "Pipeline", icon: Network,  shortcut: "6" },
  { id: "clibridge", label: "CLI Bridge", icon: Shell, shortcut: "0" },
];

const ORGANIZE_TOOLS: ToolItem[] = [
  { id: "gallery", label: "Gallery", icon: LayoutGrid, shortcut: "7" },
];

const EXTERNAL_TOOLS: ToolItem[] = [
  { id: "space", label: "Space", icon: Rocket, shortcut: "8" },
];

function ToolGroup({
  title, tools, activeTool, onToolChange, collapsed, T,
}: {
  title: string;
  tools: ToolItem[];
  activeTool: StudioTool;
  onToolChange: (t: StudioTool) => void;
  collapsed: boolean;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="mb-1">
      {!collapsed && (
        <div
          className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em]"
          style={{ color: T.textMuted + "80" }}
        >
          {title}
        </div>
      )}
      <div className="space-y-0.5 px-1.5">
        {tools.map((tool) => {
          const active = activeTool === tool.id;
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              onClick={() => onToolChange(tool.id)}
              className={`group relative w-full flex items-center gap-2.5 rounded-lg transition-all duration-200 ${
                collapsed ? "justify-center px-2 py-2.5" : "px-2.5 py-2"
              } ${active ? "" : "hover:bg-white/5"}`}
              style={{
                color: active ? T.accentColor : T.textColor + "99",
                backgroundColor: active ? T.accentColor + "12" : "transparent",
                boxShadow: active ? `inset 0 0 0 1px ${T.accentColor}25, 0 0 12px ${T.accentColor}10` : "none",
              }}
              title={collapsed ? `${tool.label} (Ctrl+${tool.shortcut})` : undefined}
            >
              {/* Active glow dot */}
              {active && (
                <span
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full"
                  style={{
                    backgroundColor: T.accentColor,
                    boxShadow: `0 0 8px ${T.accentColor}, 0 0 16px ${T.accentColor}60`,
                  }}
                />
              )}
              <Icon
                size={collapsed ? 20 : 16}
                strokeWidth={active ? 2.5 : 1.8}
                className="shrink-0 transition-transform duration-200 group-hover:scale-110"
              />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left text-[11px] font-bold tracking-wide">
                    {tool.label}
                  </span>
                  <kbd
                    className="text-[9px] px-1 py-px rounded font-mono opacity-40"
                    style={{
                      backgroundColor: T.bgColor + "60",
                      color: T.textMuted,
                    }}
                  >
                    {tool.shortcut}
                  </kbd>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
    <aside
      className="flex flex-col h-full shrink-0 transition-all duration-300 ease-out"
      style={{
        width: collapsed ? "64px" : "196px",
        backgroundColor: T.boxBg + "70",
        backdropFilter: "blur(20px) saturate(180%)",
        borderRight: `1px solid ${T.borderColor}18`,
      }}
    >
      {/* Logo header */}
      <div
        className="flex items-center justify-between px-3 h-11 shrink-0"
        style={{ borderBottom: `1px solid ${T.borderColor}12` }}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
              }}
            >
              <Sparkles size={11} className="text-white" />
            </div>
            <span className="text-[11px] font-black uppercase tracking-[0.15em]" style={{ color: T.headerColor }}>
              Studio
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="p-1 rounded-md transition-all hover:bg-white/10 hover:scale-105"
          style={{ color: T.textMuted + "80" }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Tools — grouped */}
      <nav className="flex-1 py-2 overflow-y-auto">
        <ToolGroup title="Create" tools={CREATE_TOOLS} activeTool={activeTool} onToolChange={onToolChange} collapsed={collapsed} T={T} />
        <ToolGroup title="AI" tools={AI_TOOLS} activeTool={activeTool} onToolChange={onToolChange} collapsed={collapsed} T={T} />
        <ToolGroup title="Organize" tools={ORGANIZE_TOOLS} activeTool={activeTool} onToolChange={onToolChange} collapsed={collapsed} T={T} />
        <ToolGroup title="External" tools={EXTERNAL_TOOLS} activeTool={activeTool} onToolChange={onToolChange} collapsed={collapsed} T={T} />
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
              style={{ backgroundColor: T.success, boxShadow: `0 0 6px ${T.success}` }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono opacity-40" style={{ color: T.textMuted }}>
              v1.0
            </span>
            <span className="flex items-center gap-1.5 text-[9px] font-mono" style={{ color: T.textMuted + "80" }}>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: T.success, boxShadow: `0 0 4px ${T.success}` }}
              />
              Online
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
