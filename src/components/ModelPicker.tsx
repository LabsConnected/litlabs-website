"use client";

import { useState, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Search, ChevronDown, Sparkles, Clock, Star, Zap, DollarSign } from "lucide-react";

interface Model {
  id: string;
  name: string;
  provider: string;
  cost: "free" | "paid" | "hybrid";
  speed: "fast" | "medium" | "slow";
  quality: "low" | "medium" | "high";
  context: number;
  recommended?: boolean;
  icon?: string;
}

const MODELS: Model[] = [
  { id: "adaptive", name: "Adaptive", provider: "Auto", cost: "hybrid", speed: "fast", quality: "high", context: 128000, recommended: true, icon: "🧠" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google", cost: "free", speed: "fast", quality: "high", context: 1000000, icon: "⚡" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google", cost: "paid", speed: "medium", quality: "high", context: 2000000, icon: "✨" },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", cost: "paid", speed: "fast", quality: "high", context: 128000, icon: "🔮" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI", cost: "free", speed: "fast", quality: "medium", context: 128000, icon: "⚡" },
  { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", cost: "paid", speed: "medium", quality: "high", context: 200000, icon: "🎯" },
  { id: "claude-3-haiku", name: "Claude 3 Haiku", provider: "Anthropic", cost: "free", speed: "fast", quality: "medium", context: 200000, icon: "🚀" },
];

interface ModelPickerProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  recentModels?: string[];
}

export default function ModelPicker({ selectedModel, onModelChange, recentModels = [] }: ModelPickerProps) {
  const { resolvedColors: T } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedModelData = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  const filteredModels = useMemo(() => {
    if (!searchQuery) return MODELS;
    return MODELS.filter(m => 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.provider.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  const recentModelsData = useMemo(() => {
    return recentModels
      .map(id => MODELS.find(m => m.id === id))
      .filter(Boolean) as Model[];
  }, [recentModels]);

  const recommendedModels = MODELS.filter(m => m.recommended);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all hover:scale-105"
        style={{
          backgroundColor: T.boxBg + "60",
          border: "1px solid " + T.borderColor + "30",
          color: T.textColor,
        }}
      >
        <span className="text-lg">{selectedModelData.icon}</span>
        <span className="text-sm font-bold">{selectedModelData.name}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
          backgroundColor: selectedModelData.cost === "free" ? "#22c55e20" : "#f59e0b20",
          color: selectedModelData.cost === "free" ? "#22c55e" : "#f59e0b",
        }}>
          {selectedModelData.cost === "free" ? "FREE" : "PAID"}
        </span>
        <ChevronDown size={14} style={{ color: T.textMuted }} />
      </button>

      {isOpen && (
        <div
          className="absolute top-full left-0 mt-2 w-80 rounded-2xl border shadow-2xl z-50 max-h-[500px] overflow-y-auto"
          style={{
            backgroundColor: T.boxBg,
            borderColor: T.borderColor + "30",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div className="p-3 border-b" style={{ borderColor: T.borderColor + "20" }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: T.bgColor + "40" }}>
              <Search size={14} style={{ color: T.textMuted }} />
              <input
                type="text"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: T.textColor }}
              />
            </div>
          </div>

          {/* Adaptive default */}
          {!searchQuery && (
            <div className="p-2">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2 px-2" style={{ color: T.textMuted }}>
                Default
              </div>
              {MODELS.filter(m => m.id === "adaptive").map((model) => (
                <button
                  key={model.id}
                  onClick={() => { onModelChange(model.id); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: selectedModel === model.id ? T.accentColor + "15" : "transparent",
                    border: selectedModel === model.id ? "1px solid " + T.accentColor + "30" : "transparent",
                  }}
                >
                  <span className="text-xl">{model.icon}</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-bold" style={{ color: T.textColor }}>{model.name}</div>
                    <div className="text-[10px]" style={{ color: T.textMuted }}>{model.provider}</div>
                  </div>
                  <Sparkles size={12} style={{ color: T.accentColor }} />
                </button>
              ))}
            </div>
          )}

          {/* Recent */}
          {!searchQuery && recentModelsData.length > 0 && (
            <div className="p-2 border-t" style={{ borderColor: T.borderColor + "20" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2 px-2" style={{ color: T.textMuted }}>
                <Clock size={10} className="inline mr-1" /> Recent
              </div>
              {recentModelsData.slice(0, 3).map((model) => (
                <button
                  key={model.id}
                  onClick={() => { onModelChange(model.id); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: selectedModel === model.id ? T.accentColor + "15" : "transparent",
                  }}
                >
                  <span className="text-lg">{model.icon}</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-bold" style={{ color: T.textColor }}>{model.name}</div>
                    <div className="text-[10px]" style={{ color: T.textMuted }}>{model.provider}</div>
                  </div>
                  {model.cost === "free" && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#22c55e20", color: "#22c55e" }}>FREE</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Recommended */}
          {!searchQuery && (
            <div className="p-2 border-t" style={{ borderColor: T.borderColor + "20" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2 px-2" style={{ color: T.textMuted }}>
                <Star size={10} className="inline mr-1" /> Recommended
              </div>
              {recommendedModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => { onModelChange(model.id); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: selectedModel === model.id ? T.accentColor + "15" : "transparent",
                  }}
                >
                  <span className="text-lg">{model.icon}</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-bold" style={{ color: T.textColor }}>{model.name}</div>
                    <div className="text-[10px]" style={{ color: T.textMuted }}>{model.provider}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {model.speed === "fast" && <Zap size={10} style={{ color: "#22c55e" }} />}
                    {model.cost === "free" && <DollarSign size={10} style={{ color: "#22c55e" }} />}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* All Models */}
          <div className="p-2 border-t" style={{ borderColor: T.borderColor + "20" }}>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-2 px-2" style={{ color: T.textMuted }}>
              All Models
            </div>
            {filteredModels.map((model) => (
              <button
                key={model.id}
                onClick={() => { onModelChange(model.id); setIsOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:scale-[1.02]"
                style={{
                  backgroundColor: selectedModel === model.id ? T.accentColor + "15" : "transparent",
                }}
              >
                <span className="text-lg">{model.icon}</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-bold" style={{ color: T.textColor }}>{model.name}</div>
                  <div className="text-[10px]" style={{ color: T.textMuted }}>{model.provider}</div>
                </div>
                <div className="flex items-center gap-2">
                  {model.speed === "fast" && <Zap size={10} style={{ color: "#22c55e" }} />}
                  {model.cost === "free" && <DollarSign size={10} style={{ color: "#22c55e" }} />}
                  {model.cost === "paid" && <DollarSign size={10} style={{ color: "#f59e0b" }} />}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
