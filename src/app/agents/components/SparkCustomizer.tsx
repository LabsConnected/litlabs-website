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

import { useState } from "react";
import Link from "next/link";
import { Palette, SlidersHorizontal, Sparkles } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  useStationStore,
  setAgentColor,
  setSkin,
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
const SKINS = [
  { id: "neon-midnight", label: "Midnight", color: "#22d3ee" },
  { id: "violet-orbit", label: "Orbit", color: "#a78bfa" },
  { id: "solar-ember", label: "Ember", color: "#fbbf24" },
] as const;

type CustomizerTab = "appearance" | "crew";

export default function SparkCustomizer() {
  const { resolvedColors: T } = useTheme();
  const layout = useStationStore();
  const [tab, setTab] = useState<CustomizerTab>("appearance");

  return (
    <section
      className="rounded-2xl border p-3"
      style={{
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "rgba(7,8,14,0.88)",
        backdropFilter: "blur(18px)",
      }}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Palette size={13} className="pointer-events-none" style={{ color: T.accentColor }} aria-hidden="true" />
          <h3 className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>
            Customizer
          </h3>
        </div>
        <div className="flex rounded-lg border p-0.5" style={{ borderColor: `${T.borderColor}35` }}>
          {([
            ["appearance", Palette, "Appearance"],
            ["crew", SlidersHorizontal, "Crew"],
          ] as const).map(([id, Icon, label]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={() => setTab(id)}
                className="grid h-6 w-6 place-items-center rounded-md transition-colors"
                style={{
                  backgroundColor: active ? `${T.accentColor}25` : "transparent",
                  color: active ? T.accentColor : T.textMuted,
                }}
              >
                <Icon size={12} className="pointer-events-none" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </header>

      {tab === "appearance" ? (
        <div className="space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
            Station skin
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {SKINS.map((skin) => {
              const active = layout.skin === skin.id;
              return (
                <button
                  key={skin.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSkin(skin.id)}
                  className="rounded-xl border p-1.5 text-left transition-transform hover:-translate-y-px"
                  style={{
                    borderColor: active ? skin.color : `${T.borderColor}30`,
                    background: `linear-gradient(135deg, ${skin.color}35, rgba(7,8,14,.65))`,
                    boxShadow: active ? `0 0 14px ${skin.color}35` : undefined,
                  }}
                >
                  <span className="mb-3 block h-4 rounded-md" style={{ backgroundColor: skin.color }} />
                  <span className="block text-[9px] font-black" style={{ color: T.textColor }}>
                    {skin.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {CUSTOMIZABLE.map((id) => {
            const current = layout.colors[id] ?? null;
            return (
              <div key={id}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: T.textMuted }}>
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
                  {PRESET_COLORS.map((color) => {
                    const active = current === color;
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setAgentColor(id, color)}
                        aria-label={`Set ${id} color to ${color}`}
                        aria-pressed={active}
                        className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                        style={{ backgroundColor: color, borderColor: active ? T.textColor : "transparent" }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Link
        href="/agents"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-[10px] font-black"
        style={{ borderColor: `${T.accentColor}45`, backgroundColor: `${T.accentColor}15`, color: T.accentColor }}
      >
        <Sparkles size={12} className="pointer-events-none" aria-hidden="true" />
        Open full customizer
      </Link>
    </section>
  );
}
