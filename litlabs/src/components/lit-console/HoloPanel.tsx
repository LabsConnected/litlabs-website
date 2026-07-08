"use client";

import { useLitConsoleTheme } from "./useLitConsoleTheme";
import { Bot, Brain, Hammer, Radio, Sparkles, X } from "lucide-react";

type HoloPanelProps = {
  onClose: () => void;
  onPrompt: (prompt: string) => void;
};

const companions = [
  {
    name: "LiT",
    role: "chat guide",
    icon: Bot,
    color: "cyan",
    prompt: "Keep LiT visible in this chat and help me with the next best action without repeating old replies.",
  },
  {
    name: "Forge",
    role: "builder",
    icon: Hammer,
    color: "orange",
    prompt: "Have Forge inspect the current project state and tell me the next concrete build fix.",
  },
  {
    name: "Visionary",
    role: "creative",
    icon: Sparkles,
    color: "pink",
    prompt: "Have Visionary improve the look and feel of this screen while keeping it mobile-first.",
  },
  {
    name: "Memory",
    role: "context",
    icon: Brain,
    color: "lime",
    prompt: "Use memory and recent chat context before answering so you do not repeat yourself.",
  },
];

export default function HoloPanel({ onClose, onPrompt }: HoloPanelProps) {
  const LC = useLitConsoleTheme();

  return (
    <div
      className="relative z-30 flex w-full shrink-0 flex-col border-t px-3 py-3 sm:px-4"
      style={{ backgroundColor: `${LC.bg}e8`, backdropFilter: "blur(18px)", borderColor: LC.border }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio size={14} style={{ color: LC.accentCyan }} />
            <span className="text-xs font-black" style={{ color: LC.text }}>
              Holo Companions
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px]" style={{ color: LC.textMuted }}>
            Inline helpers stay with the chat. No preview window, no blocked screen.
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
          style={{ color: LC.textMuted }}
          aria-label="Close holo companions"
        >
          <X size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-4">
        {companions.map((companion) => {
          const Icon = companion.icon;
          const accent =
            companion.color === "orange"
              ? LC.accentOrange
              : companion.color === "pink"
                ? LC.accentPurple
                : companion.color === "lime"
                  ? LC.success
                  : LC.accentCyan;

          return (
            <button
              key={companion.name}
              onClick={() => onPrompt(companion.prompt)}
              className="group flex min-h-[76px] items-center gap-3 rounded-2xl border px-3 py-3 text-left transition active:scale-[0.98]"
              style={{
                backgroundColor: `${LC.bgPanel}b8`,
                borderColor: `${accent}35`,
                boxShadow: `0 0 18px ${accent}12`,
              }}
            >
              <span
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border"
                style={{
                  borderColor: `${accent}55`,
                  background: `radial-gradient(circle, ${accent}26, ${LC.bgPanel} 72%)`,
                  color: accent,
                }}
              >
                <span
                  className="absolute inset-0 rounded-2xl opacity-0 blur-md transition group-hover:opacity-40"
                  style={{ backgroundColor: accent }}
                />
                <Icon className="relative" size={19} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-black" style={{ color: LC.text }}>
                  {companion.name}
                </span>
                <span className="block truncate text-[10px]" style={{ color: LC.textMuted }}>
                  {companion.role}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="mt-3 rounded-2xl border px-3 py-2 text-[11px] leading-snug"
        style={{ backgroundColor: `${LC.bgPanel}82`, borderColor: LC.borderSubtle, color: LC.textMuted }}
      >
        Holo now acts like speak mode: it stays inside the console and feeds better context into the chat instead of opening another view.
      </div>
    </div>
  );
}
