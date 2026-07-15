"use client";

import { useTheme } from "@/context/ThemeContext";
import {
  Bot,
  LayoutGrid,
  Microscope,
  Monitor,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export type StudioMode = "command" | "media" | "research" | "agent" | "minimal";

const MODES: {
  id: StudioMode;
  label: string;
  icon: LucideIcon;
  accent: string;
  desc: string;
}[] = [
  {
    id: "command",
    label: "Command",
    icon: Monitor,
    accent: "#00ffff",
    desc: "Default all-purpose home base",
  },
  {
    id: "media",
    label: "Media",
    icon: Wand2,
    accent: "#ff6b35",
    desc: "Image, video, audio, color",
  },
  {
    id: "research",
    label: "Research",
    icon: Microscope,
    accent: "#e879f9",
    desc: "Sources, citations, answers",
  },
  {
    id: "agent",
    label: "Agent Ops",
    icon: Bot,
    accent: "#22d3ee",
    desc: "Agents, queues, runs, cost",
  },
  {
    id: "minimal",
    label: "Minimal",
    icon: LayoutGrid,
    accent: "#a8adbd",
    desc: "Ship fast with less chrome",
  },
];

/**
 * StudioModeSwitcher — pill row that swaps the entire Studio between
 * the different layout "modes" defined in the wireframes:
 *
 *  Command (default) — Media — Research — Agent Ops — Minimal
 *
 * The active mode can change the right-rail preset, the dock's
 * default tools, and the welcome state.
 */
export default function StudioModeSwitcher({
  active,
  onChange,
  T,
}: {
  active: StudioMode;
  onChange: (m: StudioMode) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div
      className="flex items-stretch gap-1 rounded-2xl border p-1"
      style={{
        backgroundColor: T.bgColor + "70",
        borderColor: T.borderColor + "20",
        backdropFilter: "blur(10px) saturate(180%)",
      }}
    >
      {MODES.map((m) => {
        const Icon = m.icon;
        const isActive = active === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 rounded-xl px-2 sm:px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] transition-all"
            style={{
              backgroundColor: isActive ? m.accent + "18" : "transparent",
              color: isActive ? m.accent : T.textMuted,
              boxShadow: isActive ? `inset 0 0 0 1px ${m.accent}40` : "none",
            }}
            title={m.desc}
            aria-label={`${m.label} mode`}
          >
            <Icon size={11} />
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Returns a recommended first tool for a given mode.
 * Used when switching modes to make the change feel meaningful.
 */
export function defaultToolForMode(
  mode: StudioMode,
): "image" | "agents" | "pipeline" | "gallery" {
  switch (mode) {
    case "command":
      return "image";
    case "media":
      return "image";
    case "research":
      return "gallery";
    case "agent":
      return "agents";
    case "minimal":
    default:
      return "image";
  }
}

export const MODE_ACCENT: Record<StudioMode, string> = MODES.reduce(
  (acc, m) => {
    acc[m.id] = m.accent;
    return acc;
  },
  {} as Record<StudioMode, string>,
);
