"use client";

import { Rocket, Wrench, PenTool, Code2, Image, Globe, Sparkles } from "lucide-react";
import { LC } from "./lit-console-theme";

interface StarterActionsProps {
  onSelect: (action: string) => void;
}

const actions = [
  {
    label: "Generate a product hero image",
    prompt: "Generate an image of a premium LiTTree AI agent workspace, cinematic lighting, glass dashboard, sharp UI details",
    icon: Image,
    color: "#e879f9",
  },
  {
    label: "Make a brand visual",
    prompt: "Create a square brand visual for LiTTree Lab Studios with a futuristic creator operating system mood",
    icon: Sparkles,
    color: LC.accentCyan,
  },
  { label: "Build an app", prompt: "Build an app for ", icon: Rocket, color: LC.accentCyan },
  { label: "Create website", prompt: "Create a website for ", icon: Globe, color: "#f472b6" },
  { label: "Fix my code", prompt: "Fix my code: ", icon: Wrench, color: LC.accentOrange },
  { label: "Write content", prompt: "Write content for ", icon: PenTool, color: LC.success },
  { label: "Review code", prompt: "Review this code: ", icon: Code2, color: "#a78bfa" },
];

export default function StarterActions({ onSelect }: StarterActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.label}
            onClick={() => onSelect(a.prompt)}
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
