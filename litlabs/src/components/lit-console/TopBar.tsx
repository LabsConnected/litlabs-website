"use client";

import { Layers, Cpu, Zap, Settings, Terminal, Circle } from "lucide-react";
import { LC } from "./lit-console-theme";

interface TopBarProps {
  projectName: string;
  agentName: string;
  modelName: string;
  status: string;
}

export default function TopBar({ projectName, agentName, modelName, status }: TopBarProps) {
  const online = status.toLowerCase() === "online" || status.toLowerCase() === "connected";

  return (
    <header
      className="flex h-[52px] w-full shrink-0 items-center justify-between px-4"
      style={{ backgroundColor: LC.bgPanel, borderBottom: `1px solid ${LC.border}` }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Terminal size={18} style={{ color: LC.accentCyan }} />
          <span className="text-sm font-semibold tracking-wide" style={{ color: LC.text }}>
            LiT Console
          </span>
        </div>
        <Circle size={8} fill={online ? LC.success : LC.danger} stroke="none" style={{ opacity: online ? 1 : 0.7 }} />
      </div>

      <div className="hidden items-center gap-2 md:flex">
        <button
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
        >
          <Layers size={14} style={{ color: LC.accentCyan }} />
          {projectName}
        </button>
        <button
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
        >
          <Cpu size={14} style={{ color: LC.accentOrange }} />
          {agentName}
        </button>
        <button
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
        >
          <Zap size={14} style={{ color: LC.success }} />
          {modelName}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ color: LC.text, border: `1px solid ${LC.border}`, backgroundColor: LC.bgSecondary }}
        >
          <Zap size={12} style={{ color: online ? LC.success : LC.danger }} />
          {status}
        </div>
        <button className="rounded-md p-1.5 transition-colors hover:bg-white/5" style={{ color: LC.textMuted }}>
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
