"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Bot,
  Image,
  Globe,
  Code,
  Music,
  LayoutGrid,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Zap,
  Puzzle,
  Settings,
  Film,
  Palette,
  PenTool,
} from "lucide-react";

type ToolItem = {
  id: string;
  label: string;
  icon: typeof Bot;
  shortcut: string;
  group: string;
};

const TOOL_ITEMS: ToolItem[] = [
  // Agent
  { id: "chat", label: "LiTT CODE", icon: Bot, shortcut: "1", group: "AGENT" },
  { id: "missions", label: "Missions", icon: Zap, shortcut: "M", group: "AGENT" },

  // Create
  { id: "image", label: "Image Studio", icon: Image, shortcut: "2", group: "CREATE" },
  { id: "video", label: "Video Studio", icon: Film, shortcut: "3", group: "CREATE" },
  { id: "audio", label: "Audio Lab", icon: Music, shortcut: "4", group: "CREATE" },
  { id: "color", label: "Color Studio", icon: Palette, shortcut: "5", group: "CREATE" },

  // Build
  { id: "builder", label: "Website Builder", icon: Globe, shortcut: "6", group: "BUILD" },
  { id: "terminal", label: "Code Lab", icon: Code, shortcut: "7", group: "BUILD" },
  { id: "canvas", label: "Canvas", icon: PenTool, shortcut: "8", group: "BUILD" },

  // Library
  { id: "gallery", label: "Gallery", icon: LayoutGrid, shortcut: "9", group: "LIBRARY" },
  { id: "agents", label: "Agents", icon: Puzzle, shortcut: "A", group: "LIBRARY" },

  // System
  { id: "settings", label: "Settings", icon: Settings, shortcut: "0", group: "SYSTEM" },
];

export default function StudioIconRail({
  activeTool,
  onToolChange,
}: {
  activeTool: string;
  onToolChange: (tool: string) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const [collapsed, setCollapsed] = useState(true);

  const groups = [
    "AGENT",
    "CREATE",
    "BUILD",
    "LIBRARY",
    "SYSTEM",
  ];

  return (
    <aside
      className="hidden md:flex flex-col h-full shrink-0 transition-all duration-300 ease-out border-r"
      style={{
        width: collapsed ? "56px" : "200px",
        backgroundColor: T.boxBg + "70",
        borderColor: T.borderColor + "18",
        backdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-2 h-12 shrink-0 border-b"
        style={{ borderColor: T.borderColor + "12" }}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 px-1">
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
              }}
            >
              <Sparkles size={10} className="text-white" />
            </div>
            <span
              className="text-[10px] font-black uppercase tracking-[0.15em]"
              style={{ color: T.headerColor }}
            >
              Studio
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="p-1 rounded-md transition-all hover:bg-white/10 ml-auto"
          style={{ color: T.textMuted + "80" }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Tools */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {groups.map((group) => {
          const groupItems = TOOL_ITEMS.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          return (
            <div key={group} className="mb-1">
              {!collapsed && (
                <div
                  className="px-3 pt-2 pb-1 text-[8px] font-bold uppercase tracking-[0.2em]"
                  style={{ color: T.textMuted + "60" }}
                >
                  {group}
                </div>
              )}
              {collapsed && (
                <div
                  className="mx-2 my-1 h-px"
                  style={{ backgroundColor: T.borderColor + "20" }}
                />
              )}
              <div className="space-y-0.5 px-1">
                {groupItems.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => onToolChange(tool.id)}
                    className="group relative w-full flex items-center rounded-lg transition-all duration-200 hover:bg-white/5"
                    style={{
                      color: activeTool === tool.id ? T.accentColor : T.textColor + "99",
                      backgroundColor: activeTool === tool.id ? T.accentColor + "12" : "transparent",
                      padding: collapsed ? "8px" : "8px 10px",
                      justifyContent: collapsed ? "center" : "flex-start",
                      gap: collapsed ? "0" : "10px",
                    }}
                    title={collapsed ? `${tool.label} (${tool.shortcut})` : undefined}
                  >
                    {/* Active indicator */}
                    {activeTool === tool.id && !collapsed && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full"
                        style={{
                          backgroundColor: T.accentColor,
                          boxShadow: `0 0 6px ${T.accentColor}`,
                        }}
                      />
                    )}
                    {activeTool === tool.id && collapsed && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full"
                        style={{
                          backgroundColor: T.accentColor,
                          boxShadow: `0 0 6px ${T.accentColor}`,
                        }}
                      />
                    )}
                    <tool.icon
                      size={collapsed ? 20 : 16}
                      strokeWidth={activeTool === tool.id ? 2.5 : 1.8}
                      className="shrink-0 transition-transform duration-200 group-hover:scale-110"
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left text-[12px] font-bold tracking-wide">
                          {tool.label}
                        </span>
                        <kbd
                          className="text-[9px] px-1 py-0.5 rounded font-mono opacity-40"
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
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom status */}
      <div
        className="px-2 py-2 shrink-0 border-t"
        style={{ borderTop: `1px solid ${T.borderColor}12` }}
      >
        {collapsed ? (
          <div className="flex justify-center">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{
                backgroundColor: T.success,
                boxShadow: `0 0 6px ${T.success}`,
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between px-1">
            <span className="text-[9px] font-mono opacity-40" style={{ color: T.textMuted }}>
              v1.0
            </span>
            <span
              className="flex items-center gap-1 text-[9px] font-mono opacity-40"
              style={{ color: T.textMuted }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: T.success }}
              />
              Online
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
