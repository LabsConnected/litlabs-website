"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Activity,
  Layers,
  Cpu,
  Settings,
} from "lucide-react";

type InspectorTab = "artifacts" | "files" | "logs" | "skills" | "models";

export default function StudioInspectorPanel() {
  const { resolvedColors: T } = useTheme();
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<InspectorTab>("artifacts");

  const tabs: { id: InspectorTab; label: string; icon: typeof Settings }[] = [
    { id: "artifacts", label: "Artifacts", icon: Layers },
    { id: "files", label: "Files", icon: FolderTree },
    { id: "logs", label: "Logs", icon: Activity },
    { id: "skills", label: "Skills", icon: Cpu },
    { id: "models", label: "Models", icon: Settings },
  ];

  return (
    <aside
      className="hidden lg:flex flex-col h-full shrink-0 transition-all duration-300 ease-out border-l"
      style={{
        width: collapsed ? "0px" : "280px",
        backgroundColor: T.boxBg + "70",
        borderColor: T.borderColor + "18",
        backdropFilter: "blur(20px) saturate(180%)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 h-12 shrink-0 border-b"
        style={{ borderColor: T.borderColor + "12" }}
      >
        {!collapsed && (
          <span
            className="text-[10px] font-black uppercase tracking-[0.15em]"
            style={{ color: T.headerColor }}
          >
            Inspector
          </span>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="p-1 rounded-md transition-all hover:bg-white/10"
          style={{ color: T.textMuted + "80" }}
          title={collapsed ? "Expand inspector" : "Collapse inspector"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: T.borderColor + "12" }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex flex-col items-center gap-1 py-2 transition-all hover:bg-white/5"
                style={{
                  color: activeTab === tab.id ? T.accentColor : T.textMuted,
                  borderBottom: activeTab === tab.id
                    ? `2px solid ${T.accentColor}`
                    : "2px solid transparent",
                }}
              >
                <tab.icon size={16} />
                <span className="text-[9px] font-semibold">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3">
            {activeTab === "artifacts" && (
              <div className="space-y-2">
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: T.bgColor + "40",
                    borderColor: T.borderColor + "20",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={14} style={{ color: T.accentColor }} />
                    <span className="text-xs font-bold" style={{ color: T.textColor }}>
                      Recent Artifacts
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] p-2 rounded" style={{ backgroundColor: T.bgColor + "50", color: T.textMuted }}>
                      landing-page.tsx
                    </div>
                    <div className="text-[10px] p-2 rounded" style={{ backgroundColor: T.bgColor + "50", color: T.textMuted }}>
                      hero-image.png
                    </div>
                    <div className="text-[10px] p-2 rounded" style={{ backgroundColor: T.bgColor + "50", color: T.textMuted }}>
                      deploy-log.txt
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "files" && (
              <div className="space-y-2">
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: T.bgColor + "40",
                    borderColor: T.borderColor + "20",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <FolderTree size={14} style={{ color: T.accentColor }} />
                    <span className="text-xs font-bold" style={{ color: T.textColor }}>
                      Project Files
                    </span>
                  </div>
                  <div className="space-y-1 text-[10px]" style={{ color: T.textMuted }}>
                    <div className="flex items-center gap-2 p-1 hover:bg-white/5 rounded cursor-pointer">
                      <span>📁</span> src/
                    </div>
                    <div className="flex items-center gap-2 p-1 hover:bg-white/5 rounded cursor-pointer pl-4">
                      <span>📁</span> app/
                    </div>
                    <div className="flex items-center gap-2 p-1 hover:bg-white/5 rounded cursor-pointer pl-8">
                      <span>📄</span> page.tsx
                    </div>
                    <div className="flex items-center gap-2 p-1 hover:bg-white/5 rounded cursor-pointer pl-8">
                      <span>📄</span> layout.tsx
                    </div>
                    <div className="flex items-center gap-2 p-1 hover:bg-white/5 rounded cursor-pointer pl-4">
                      <span>📁</span> components/
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "logs" && (
              <div className="space-y-2">
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: T.bgColor + "40",
                    borderColor: T.borderColor + "20",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Activity size={14} style={{ color: T.accentColor }} />
                    <span className="text-xs font-bold" style={{ color: T.textColor }}>
                      Activity Log
                    </span>
                  </div>
                  <div className="space-y-1 text-[9px] font-mono" style={{ color: T.textMuted }}>
                    <div className="p-1 rounded" style={{ backgroundColor: T.bgColor + "30" }}>
                      [10:32:15] Build started
                    </div>
                    <div className="p-1 rounded" style={{ backgroundColor: T.bgColor + "30" }}>
                      [10:32:18] TypeScript check passed
                    </div>
                    <div className="p-1 rounded" style={{ backgroundColor: T.bgColor + "30" }}>
                      [10:32:20] Build complete
                    </div>
                    <div className="p-1 rounded" style={{ backgroundColor: T.bgColor + "30" }}>
                      [10:32:22] Deploying to Vercel
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "skills" && (
              <div className="space-y-2">
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: T.bgColor + "40",
                    borderColor: T.borderColor + "20",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu size={14} style={{ color: T.accentColor }} />
                    <span className="text-xs font-bold" style={{ color: T.textColor }}>
                      Active Skills
                    </span>
                  </div>
                  <div className="space-y-1">
                    {["Code Fixer", "App Builder", "Image Studio"].map((skill) => (
                      <div
                        key={skill}
                        className="flex items-center justify-between p-2 rounded-lg"
                        style={{
                          backgroundColor: T.bgColor + "50",
                          border: `1px solid ${T.accentColor}30`,
                        }}
                      >
                        <span className="text-[10px] font-semibold" style={{ color: T.textColor }}>
                          {skill}
                        </span>
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: T.accentColor,
                            boxShadow: `0 0 6px ${T.accentColor}`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "models" && (
              <div className="space-y-2">
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: T.bgColor + "40",
                    borderColor: T.borderColor + "20",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Settings size={14} style={{ color: T.accentColor }} />
                    <span className="text-xs font-bold" style={{ color: T.textColor }}>
                      Model Settings
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: T.textMuted }}>
                        Temperature
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        defaultValue="0.7"
                        className="w-full mt-1"
                        style={{ accentColor: T.accentColor }}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: T.textMuted }}>
                        Max Tokens
                      </label>
                      <input
                        type="number"
                        defaultValue="4096"
                        className="w-full mt-1 px-2 py-1 rounded text-xs"
                        style={{
                          backgroundColor: T.bgColor + "50",
                          borderColor: T.borderColor + "30",
                          color: T.textColor,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
