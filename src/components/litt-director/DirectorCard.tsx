"use client";

import { useTheme } from "@/context/ThemeContext";
import {
  HelpCircle,
  Image,
  Wrench,
  Code,
  Bot,
  Search,
  Brain,
  Rocket,
  Sparkles,
  ChevronRight,
} from "lucide-react";

export type DirectorMode =
  | "ask"
  | "image"
  | "build"
  | "code"
  | "agent"
  | "search"
  | "memory"
  | "deploy";

const MODES: { id: DirectorMode; label: string; icon: typeof HelpCircle }[] = [
  { id: "ask", label: "Ask", icon: HelpCircle },
  { id: "image", label: "Image", icon: Image },
  { id: "build", label: "Build", icon: Wrench },
  { id: "code", label: "Code", icon: Code },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "search", label: "Search", icon: Search },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "deploy", label: "Deploy", icon: Rocket },
];

export function DirectorCard({
  onOpenAction,
  onModeAction,
  workspaceName = "LitLabs",
}: {
  onOpenAction?: () => void;
  onModeAction?: (mode: DirectorMode) => void;
  workspaceName?: string;
}) {
  const { resolvedColors: T } = useTheme();

  return (
    <div
      className="m-3 rounded-2xl border p-3 shadow-lg shadow-black/10"
      style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
    >
      <button
        onClick={onOpenAction}
        className="flex w-full items-center gap-3 rounded-xl p-2 transition hover:bg-white/5"
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: T.accentColor + "20" }}
        >
          <Sparkles size={18} style={{ color: T.accentColor }} />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div
            className="flex items-center gap-1 text-xs font-black uppercase tracking-wider"
            style={{ color: T.headerColor }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: T.accentColor }}
            />{" "}
            LiTT Director
          </div>
          <div className="truncate text-[10px] opacity-60">
            Working in: {workspaceName}
          </div>
        </div>
        <ChevronRight size={14} className="opacity-40" />
      </button>

      <button
        onClick={onOpenAction}
        className="mt-2 flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition hover:bg-white/5"
        style={{ borderColor: T.borderColor, color: T.textMuted }}
      >
        <Sparkles size={12} className="opacity-50" />
        Ask LiTT…
      </button>

      <div className="mt-2 grid grid-cols-4 gap-1">
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => onModeAction?.(m.id)}
              className="flex flex-col items-center gap-1 rounded-lg py-1.5 text-[9px] font-bold transition hover:bg-white/5"
              style={{ color: T.textColor }}
            >
              <Icon size={14} style={{ color: T.accentColor }} />
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { MODES };
