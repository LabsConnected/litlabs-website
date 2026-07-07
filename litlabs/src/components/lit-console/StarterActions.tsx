"use client";

import { Rocket, Wrench, PenTool, Code2, Image, Globe } from "lucide-react";
import { LC } from "./lit-console-theme";

interface StarterActionsProps {
  onSelect: (action: string) => void;
}

const actions = [
  { label: "Build an app", icon: Rocket, color: LC.accentCyan },
  { label: "Fix my code", icon: Wrench, color: LC.accentOrange },
  { label: "Write content", icon: PenTool, color: LC.success },
  { label: "Generate image", icon: Image, color: "#e879f9" },
  { label: "Create website", icon: Globe, color: "#f472b6" },
  { label: "Review code", icon: Code2, color: "#a78bfa" },
];

export default function StarterActions({ onSelect }: StarterActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.label}
            onClick={() => onSelect(a.label)}
            className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all hover:scale-[1.03]"
            style={{
              backgroundColor: LC.bgPanel,
              borderColor: LC.border,
              color: LC.text,
            }}
          >
            <Icon size={15} style={{ color: a.color }} />
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
