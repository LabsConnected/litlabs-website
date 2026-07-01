"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Palette, Sparkles, Zap, Sun, Moon, Stars } from "lucide-react";

interface StylePreset {
  id: string;
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  mood: "cinematic" | "clean" | "playful" | "realistic" | "neon";
  icon: string;
}

const STYLE_PRESETS: StylePreset[] = [
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Dramatic lighting and rich colors",
    colors: { primary: "#f97316", secondary: "#fbbf24", accent: "#ef4444", background: "#0a0a0f" },
    mood: "cinematic",
    icon: "🎬",
  },
  {
    id: "clean",
    name: "Clean",
    description: "Minimal and professional",
    colors: { primary: "#3b82f6", secondary: "#60a5fa", accent: "#2563eb", background: "#ffffff" },
    mood: "clean",
    icon: "✨",
  },
  {
    id: "playful",
    name: "Playful",
    description: "Bright and energetic",
    colors: { primary: "#ec4899", secondary: "#f472b6", accent: "#f97316", background: "#fdf2f8" },
    mood: "playful",
    icon: "🎨",
  },
  {
    id: "realistic",
    name: "Realistic",
    description: "Natural and lifelike",
    colors: { primary: "#22c55e", secondary: "#10b981", accent: "#059669", background: "#f0fdf4" },
    mood: "realistic",
    icon: "🌿",
  },
  {
    id: "neon",
    name: "Neon",
    description: "Electric and futuristic",
    colors: { primary: "#06b6d4", secondary: "#22d3ee", accent: "#d946ef", background: "#0f172a" },
    mood: "neon",
    icon: "⚡",
  },
];

interface StylePresetsProps {
  onStyleSelect?: (preset: StylePreset) => void;
}

export default function StylePresets({ onStyleSelect }: StylePresetsProps) {
  const { resolvedColors: T } = useTheme();
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  const getMoodIcon = (mood: StylePreset["mood"]) => {
    switch (mood) {
      case "cinematic": return <Moon size={12} />;
      case "clean": return <Sun size={12} />;
      case "playful": return <Stars size={12} />;
      case "realistic": return <Palette size={12} />;
      case "neon": return <Zap size={12} />;
      default: return <Sparkles size={12} />;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Palette size={18} style={{ color: T.accentColor }} />
        <span className="text-sm font-bold" style={{ color: T.textColor }}>Style Presets</span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {STYLE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => { setSelectedPreset(preset.id); onStyleSelect?.(preset); }}
            className="p-3 rounded-lg text-left transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: selectedPreset === preset.id ? T.accentColor + "15" : T.boxBg + "40",
              border: selectedPreset === preset.id ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "20",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{preset.icon}</span>
              <div className="flex-1">
                <div className="text-xs font-bold" style={{ color: T.textColor }}>{preset.name}</div>
                <div className="text-[9px]" style={{ color: T.textMuted }}>{preset.description}</div>
              </div>
              {getMoodIcon(preset.mood)}
            </div>
            <div className="flex gap-1">
              <div className="h-2 flex-1 rounded" style={{ backgroundColor: preset.colors.primary }} />
              <div className="h-2 flex-1 rounded" style={{ backgroundColor: preset.colors.secondary }} />
              <div className="h-2 flex-1 rounded" style={{ backgroundColor: preset.colors.accent }} />
              <div className="h-2 flex-1 rounded" style={{ backgroundColor: preset.colors.background }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
