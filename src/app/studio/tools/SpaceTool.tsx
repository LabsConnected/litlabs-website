"use client";

import { useTheme } from "@/context/ThemeContext";
import { ExternalLink } from "lucide-react";

const SPACE_URL = "https://rvc0r914lvjh.space.minimax.io";

export default function SpaceTool() {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 h-10 shrink-0"
        style={{ borderBottom: `1px solid ${T.borderColor}15` }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.accentColor }}>
            MiniMax Space
          </span>
        </div>
        <a
          href={SPACE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-all hover:opacity-80"
          style={{ color: T.textMuted, border: `1px solid ${T.borderColor}20` }}
        >
          <ExternalLink size={10} /> Open in Tab
        </a>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative">
        <iframe
          src={SPACE_URL}
          className="w-full h-full border-0"
          title="MiniMax Space"
          allow="fullscreen; camera; microphone"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
        />
      </div>
    </div>
  );
}
