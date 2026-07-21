"use client";

/**
 * Placeholder for the LiTT Base Station.
 *
 * Phase 1 (cleanup) replaces the previous re-export of `./AgentsTerminalTool`
 * with a minimal launcher panel. Phase 4 will swap this implementation for the
 * real `BaseStationShell` component, which is shared between `/agents` and the
 * Studio workspace.
 */

import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export default function AgentTool() {
  const { resolvedColors: T } = useTheme();

  return (
    <div
      className="flex h-full min-h-0 items-center justify-center p-6"
      style={{ color: T.textColor }}
    >
      <div
        className="w-full max-w-md rounded-3xl border p-6 text-center"
        style={{
          borderColor: `${T.accentColor}30`,
          backgroundColor: `${T.boxBg}cc`,
        }}
      >
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
            boxShadow: `0 0 24px ${T.accentColor}30`,
          }}
        >
          <Bot size={26} color="#fff" />
        </div>
        <h2
          className="text-lg font-black"
          style={{ color: T.headerColor }}
        >
          LiTT Base Station
        </h2>
        <p
          className="mt-2 text-xs leading-5"
          style={{ color: T.textMuted }}
        >
          The embedded Base Station is coming to Studio in a later phase. For now, open the full Base Station console.
        </p>
        <Link
          href="/agents"
          className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black"
          style={{ backgroundColor: T.accentColor, color: T.bgColor }}
        >
          Open Base Station <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
