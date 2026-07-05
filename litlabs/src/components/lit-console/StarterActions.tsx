"use client";

import { Rocket, Wrench, PenTool } from "lucide-react";
import { LC } from "./lit-console-theme";

interface StarterActionsProps {
  onSelect: (action: string) => void;
}

const actions = [
  {
    label: "Build an app",
    subtitle: "Create a new app from a prompt or template",
    icon: Rocket,
    color: LC.accentCyan,
    hoverBorder: "hover:border-cyan-400",
  },
  {
    label: "Fix my code",
    subtitle: "Find bugs, refactor, and patch files",
    icon: Wrench,
    color: LC.accentOrange,
    hoverBorder: "hover:border-orange-400",
  },
  {
    label: "Create content",
    subtitle: "Write docs, copy, posts, or scripts",
    icon: PenTool,
    color: LC.success,
    hoverBorder: "hover:border-green-500",
  },
];

export default function StarterActions({ onSelect }: StarterActionsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.label}
            onClick={() => onSelect(a.label)}
            className={`group flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all hover:-translate-y-0.5 ${a.hoverBorder}`}
            style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
          >
            <div className="rounded-lg p-2" style={{ color: a.color, backgroundColor: `${a.color}15` }}>
              <Icon size={22} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: LC.text }}>
                {a.label}
              </div>
              <div className="mt-1 text-xs leading-relaxed" style={{ color: LC.textMuted }}>
                {a.subtitle}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
