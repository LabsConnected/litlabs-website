"use client";

import { useTheme } from "@/context/ThemeContext";

export default function PluginsTool() {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 overflow-auto p-4"
      style={{ color: T.textColor }}
    >
      <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
        <div className="mb-2 flex items-center gap-2">
          <div
            className="text-[10px] font-black uppercase tracking-[0.2em]"
            style={{ color: T.accentColor }}
          >
            Plugin Manager
          </div>
        </div>
        <p className="text-xs" style={{ color: T.textMuted }}>
          Extend Studio with integrations, media providers, and agent skills.
        </p>
      </div>
      <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-xs" style={{ color: T.textMuted }}>
        No plugins installed yet.
      </div>
    </div>
  );
}
