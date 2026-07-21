"use client";

/**
 * LiTT Base Station — SparkCustomizer
 *
 * Lets the user recolor Spark (and optionally LiTT) without touching the
 * underlying AGENTS registry. Writes through `setAgentColor` in the
 * station store; Phase 5 will expand this to skins, avatars, and home
 * zones. For Phase 4 the customizer is intentionally minimal: 6 preset
 * colors + a free-form color input.
 */

import { Palette } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  useStationStore,
  setAgentColor,
  type AgentId,
} from "../store/stationStore";

const PRESET_COLORS: ReadonlyArray<string> = [
  "#f472b6", // pink (default Spark)
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#34d399", // emerald
  "#fbbf24", // amber
  "#fb7185", // rose
];

const CUSTOMIZABLE: AgentId[] = ["spark", "litt"];

export default function SparkCustomizer() {
  const { resolvedColors: T } = useTheme();
  const layout = useStationStore();
  return (
    <section
      className="rounded-2xl border p-3"
      style={{ borderColor: `${T.accentColor}25`, backgroundColor: `${T.boxBg}cc` }}
    >
      <header className="mb-2 flex items-center gap-2">
        <Palette size={13} style={{ color: T.accentColor }} />
        <h3 className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>
          Customizer
        </h3>
      </header>
      <div className="space-y-3">
        {CUSTOMIZABLE.map((id) => {
          const current = layout.colors[id] ?? null;
          return (
            <div key={id}>
              <div className="mb-1 flex items-center justify-between">
                <span
                  className="text-[10px] font-black uppercase tracking-wider"
                  style={{ color: T.textMuted }}
                >
                  {id}
                </span>
                <button
                  type="button"
                  onClick={() => setAgentColor(id, null)}
                  disabled={!current}
                  className="text-[9px] font-bold uppercase opacity-60 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                  style={{ color: T.textMuted }}
                >
                  Reset
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map((c) => {
                  const active = current === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAgentColor(id, c)}
                      aria-label={`Set ${id} color to ${c}`}
                      className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: active ? T.textColor : "transparent",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
