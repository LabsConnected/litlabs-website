"use client";

/**
 * LiTT Base Station — StationSettings
 *
 * Top-bar style settings panel: mode switcher (Explore / Edit / Command),
 * save status pill, and a "Reset layout" button. Phase 5 will add
 * theme/skin controls and home-zone management.
 */

import { Compass, Pencil, Command, Save, RotateCcw } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  setMode,
  resetLayout,
  saveToLocalStorage,
  useStationStore,
  type StationMode,
} from "../store/stationStore";

const MODES: ReadonlyArray<{ id: StationMode; label: string; icon: typeof Compass }> = [
  { id: "explore", label: "Explore", icon: Compass },
  { id: "edit", label: "Edit", icon: Pencil },
  { id: "command", label: "Command", icon: Command },
];

interface StationSettingsProps {
  saving: boolean;
}

export default function StationSettings({ saving }: StationSettingsProps) {
  const { resolvedColors: T } = useTheme();
  const layout = useStationStore();
  return (
    <section
      className="flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2"
      style={{ borderColor: `${T.accentColor}25`, backgroundColor: `${T.boxBg}cc` }}
    >
      <div className="flex items-center gap-1.5">
        {MODES.map(({ id, label, icon: Icon }) => {
          const active = layout.mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={active}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                borderColor: active ? T.accentColor : `${T.borderColor}30`,
                backgroundColor: active ? `${T.accentColor}22` : "transparent",
                color: active ? T.accentColor : T.textMuted,
                boxShadow: active ? `0 0 14px ${T.accentColor}30` : undefined,
                outlineColor: T.accentColor,
              }}
            >
              <Icon size={10} className="pointer-events-none" aria-hidden="true" /> {label}
            </button>
          );
        })}
      </div>

      <div className="mx-1 h-5 w-px" style={{ backgroundColor: `${T.borderColor}30` }} />

      <div
        className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider"
        style={{ color: saving ? T.accentColor : T.textMuted }}
      >
        <Save size={10} className={`pointer-events-none ${saving ? "animate-pulse" : ""}`} aria-hidden="true" />
        {saving ? "Saving…" : "Saved"}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            resetLayout();
            saveToLocalStorage();
          }}
          className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-all"
          style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}
        >
          <RotateCcw size={10} className="pointer-events-none" aria-hidden="true" /> Reset
        </button>
      </div>
    </section>
  );
}
