"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Clock,
  DollarSign,
  Search,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { CHAT_ROOMS } from "@/lib/chatRooms";

type Model = {
  id: string;
  name: string;
  provider: string;
  cost: "free" | "paid" | "hybrid";
  speed: "fast" | "medium" | "slow";
  recommended?: boolean;
  icon: string;
};

const MODELS: Model[] = [
  {
    id: "adaptive",
    name: "Adaptive",
    provider: "Auto",
    cost: "hybrid",
    speed: "fast",
    recommended: true,
    icon: "🧠",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    cost: "free",
    speed: "fast",
    icon: "⚡",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    cost: "paid",
    speed: "fast",
    icon: "🔮",
  },
  {
    id: "claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    cost: "paid",
    speed: "medium",
    icon: "🎯",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    cost: "free",
    speed: "fast",
    icon: "⚡",
  },
  {
    id: "ollama-local",
    name: "Local Ollama",
    provider: "Local",
    cost: "free",
    speed: "medium",
    icon: "🖥️",
  },
];

export default function ModelPicker({
  selectedModel,
  onModelChange,
  recentModels = [],
}: {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  recentModels?: string[];
}) {
  const { resolvedColors: T } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = MODELS.find((m) => m.id === selectedModel) ?? MODELS[0];
  const filtered = useMemo(() => {
    if (!query) return MODELS;
    const q = query.toLowerCase();
    return MODELS.filter((m) =>
      `${m.name} ${m.provider}`.toLowerCase().includes(q),
    );
  }, [query]);

  const recent = useMemo(
    () =>
      recentModels
        .map((id) => MODELS.find((m) => m.id === id))
        .filter(Boolean) as Model[],
    [recentModels],
  );

  const relatedRoom = CHAT_ROOMS.find((room) => room.modelId === selected.id);
  const badgeColor =
    selected.cost === "free"
      ? "#34d399"
      : selected.cost === "paid"
        ? "#f59e0b"
        : T.accentColor;
  const badgeTextColor = selected.cost === "hybrid" ? T.textColor : badgeColor;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-2xl border px-4 py-3 text-left"
        style={{
          backgroundColor: T.boxBg + "70",
          borderColor: T.borderColor + "24",
          color: T.textColor,
        }}
      >
        <span className="text-lg">{selected.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">
            {selected.name}
          </span>
          <span
            className="block text-[10px] uppercase tracking-[0.2em]"
            style={{ color: T.textMuted }}
          >
            {relatedRoom?.label ?? selected.provider}
          </span>
        </span>
        <span
          className="rounded-full px-2 py-1 text-[10px] font-black uppercase"
          style={{ backgroundColor: badgeColor + "22", color: badgeTextColor }}
        >
          {selected.cost}
        </span>
        <ChevronDown size={14} style={{ color: T.textMuted }} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,90vw)] overflow-hidden rounded-3xl border shadow-2xl"
          style={{
            backgroundColor: T.boxBg,
            borderColor: T.borderColor + "28",
          }}
        >
          <div
            className="border-b p-3"
            style={{ borderColor: T.borderColor + "18" }}
          >
            <div
              className="flex items-center gap-2 rounded-2xl border px-3 py-2"
              style={{
                backgroundColor: T.bgColor + "50",
                borderColor: T.borderColor + "18",
              }}
            >
              <Search size={14} style={{ color: T.textMuted }} />
              <input
                id="model-picker-search"
                name="model-picker-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: T.textColor }}
              />
            </div>
          </div>

          {!query && recent.length > 0 && (
            <div
              className="border-b p-3"
              style={{ borderColor: T.borderColor + "18" }}
            >
              <div
                className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em]"
                style={{ color: T.textMuted }}
              >
                <Clock size={10} /> Recent
              </div>
              <div className="space-y-2">
                {recent.slice(0, 3).map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onModelChange(model.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all hover:bg-white/5"
                  >
                    <span className="text-lg">{model.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">
                        {model.name}
                      </span>
                      <span
                        className="block text-[10px]"
                        style={{ color: T.textMuted }}
                      >
                        {model.provider}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!query && (
            <div
              className="border-b p-3"
              style={{ borderColor: T.borderColor + "18" }}
            >
              <div
                className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em]"
                style={{ color: T.textMuted }}
              >
                <Star size={10} /> Recommended
              </div>
              {MODELS.filter((m) => m.recommended).map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onModelChange(model.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all hover:bg-white/5"
                >
                  <span className="text-lg">{model.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">
                      {model.name}
                    </span>
                    <span
                      className="block text-[10px]"
                      style={{ color: T.textMuted }}
                    >
                      {model.provider}
                    </span>
                  </span>
                  <Sparkles size={12} style={{ color: T.accentColor }} />
                </button>
              ))}
            </div>
          )}

          <div className="max-h-72 overflow-auto p-3">
            <div
              className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: T.textMuted }}
            >
              <DollarSign size={10} /> All models
            </div>
            <div className="space-y-2">
              {filtered.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onModelChange(model.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-all hover:scale-[1.01]"
                  style={{
                    backgroundColor:
                      selectedModel === model.id
                        ? T.accentColor + "16"
                        : "transparent",
                    borderColor:
                      selectedModel === model.id
                        ? T.accentColor + "30"
                        : "transparent",
                  }}
                >
                  <span className="text-lg">{model.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">
                      {model.name}
                    </span>
                    <span
                      className="block text-[10px]"
                      style={{ color: T.textMuted }}
                    >
                      {model.provider}
                    </span>
                  </span>
                  {model.cost === "free" ? (
                    <Zap size={12} style={{ color: "#34d399" }} />
                  ) : (
                    <DollarSign size={12} style={{ color: "#f59e0b" }} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
