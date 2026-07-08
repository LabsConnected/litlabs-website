"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import ModelPicker from "@/components/ModelPicker";
import { Menu, Settings, Coins, Zap, Puzzle, X, ChevronDown } from "lucide-react";

type Skill = {
  id: string;
  name: string;
  enabled: boolean;
  icon: string;
};

const DEFAULT_SKILLS: Skill[] = [
  { id: "code-fixer", name: "Code Fixer", enabled: true, icon: "🔧" },
  { id: "app-builder", name: "App Builder", enabled: true, icon: "🏗️" },
  { id: "image-studio", name: "Image Studio", enabled: true, icon: "🎨" },
  { id: "web-search", name: "Web Search", enabled: false, icon: "🔍" },
  { id: "local-exec", name: "Local Execute", enabled: false, icon: "💻" },
  { id: "file-sync", name: "File Sync", enabled: false, icon: "📁" },
];

export default function StudioTopRuntimeBar({
  selectedModel,
  onModelChange,
  onMenuToggle,
}: {
  selectedModel: string;
  onModelChange: (model: string) => void;
  onMenuToggle?: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const { balance, isLoading: walletLoading } = useWallet();
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skills, setSkills] = useState<Skill[]>(DEFAULT_SKILLS);
  const skillsRef = useRef<HTMLDivElement>(null);

  const enabledCount = skills.filter((s) => s.enabled).length;

  const toggleSkill = (skillId: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  // Close skills panel when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (skillsRef.current && !skillsRef.current.contains(e.target as Node)) {
        setSkillsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Ctrl+M keyboard shortcut for model picker
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        // ModelPicker will handle this via its own state
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <header
      className="flex items-center justify-between px-3 sm:px-4 h-12 shrink-0 border-b"
      style={{
        backgroundColor: T.boxBg + "d0",
        borderColor: T.borderColor + "20",
        backdropFilter: "blur(14px) saturate(180%)",
      }}
    >
      {/* Left: Menu + Logo */}
      <div className="flex items-center gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="rounded-lg p-2 transition-all hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Toggle menu"
          >
            <Menu size={18} />
          </button>
        )}
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
            }}
          >
            <Zap size={12} className="text-white" />
          </div>
          <span
            className="text-[11px] font-black uppercase tracking-[0.15em] hidden sm:block"
            style={{ color: T.headerColor }}
          >
            LiTTree OS
          </span>
        </div>
      </div>

      {/* Right: Model + Skills + Wallet + Settings */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Model Picker */}
        <div className="hidden sm:block w-48">
          <ModelPicker selectedModel={selectedModel} onModelChange={onModelChange} />
        </div>

        {/* Skills Toggle */}
        <div className="relative" ref={skillsRef}>
          <button
            onClick={() => setSkillsOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all hover:bg-white/5"
            style={{
              backgroundColor: T.bgColor + "60",
              borderColor: T.borderColor + "25",
              color: T.textColor,
            }}
          >
            <Puzzle size={14} />
            <span className="hidden sm:inline">Skills</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-black"
              style={{
                backgroundColor: enabledCount > 0 ? T.accentColor + "30" : T.textMuted + "20",
                color: enabledCount > 0 ? T.accentColor : T.textMuted,
              }}
            >
              {enabledCount}
            </span>
            <ChevronDown size={12} style={{ color: T.textMuted }} />
          </button>

          {skillsOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border shadow-2xl"
              style={{
                backgroundColor: T.boxBg,
                borderColor: T.borderColor + "28",
              }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: T.borderColor + "18" }}>
                <span className="text-xs font-bold" style={{ color: T.textColor }}>
                  Active Skills
                </span>
                <button
                  onClick={() => setSkillsOpen(false)}
                  className="rounded p-1 hover:bg-white/10"
                  style={{ color: T.textMuted }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="p-2 space-y-1">
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all hover:bg-white/5"
                    style={{
                      backgroundColor: skill.enabled ? T.accentColor + "15" : "transparent",
                      border: skill.enabled ? `1px solid ${T.accentColor}30` : "1px solid transparent",
                    }}
                  >
                    <span className="text-sm">{skill.icon}</span>
                    <span className="flex-1 text-xs font-semibold" style={{ color: T.textColor }}>
                      {skill.name}
                    </span>
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: skill.enabled ? T.accentColor : T.textMuted + "40",
                        boxShadow: skill.enabled ? `0 0 8px ${T.accentColor}` : "none",
                      }}
                    />
                  </button>
                ))}
              </div>
              <div className="px-3 py-2 border-t text-[10px]" style={{ borderColor: T.borderColor + "18", color: T.textMuted }}>
                Type / in prompt to trigger skills
              </div>
            </div>
          )}
        </div>

        {/* Wallet */}
        <div
          className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold"
          style={{
            backgroundColor: T.bgColor + "60",
            borderColor: T.borderColor + "20",
            color: T.accentColor,
          }}
        >
          <Coins size={10} />
          {walletLoading ? "—" : balance.toLocaleString()}
          <span className="opacity-50 text-[8px] uppercase">LBC</span>
        </div>

        {/* Settings */}
        <a
          href="/settings"
          className="rounded-lg p-1.5 hover:bg-white/10 transition-colors"
          style={{ color: T.textMuted }}
        >
          <Settings size={16} />
        </a>
      </div>
    </header>
  );
}
