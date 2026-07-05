"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Play, Square, Radio, Users } from "lucide-react";
import { RADIO } from "./dashboard-data";

type Station = (typeof RADIO)[number];

interface RadioPanelProps {
  mode?: "mini" | "full";
}

function EqualizerBars({ active, color }: { active: boolean; color: string }) {
  return (
    <div className="flex items-end gap-[2px] h-4">
      {[3, 5, 4, 6, 3, 5].map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm transition-all"
          style={{
            backgroundColor: color,
            height: active ? `${h * 2}px` : "4px",
            animation: active ? `pulse ${0.4 + i * 0.07}s ease-in-out infinite alternate` : "none",
            opacity: active ? 0.9 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

function LiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full"
      style={{
        backgroundColor: active ? "#ff000025" : "#66668825",
        color: active ? "#ff4444" : "#666688",
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{
          backgroundColor: active ? "#ff4444" : "#666688",
          animation: active ? "pulse 1s infinite" : "none",
        }}
      />
      Live
    </span>
  );
}

export default function RadioPanel({ mode = "full" }: RadioPanelProps) {
  const { resolvedColors: T } = useTheme();
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("litlabs_radio_station") ?? null;
  });
  const [playing, setPlaying] = useState(false);
  const [listenerCounts, setListenerCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(RADIO.map((s) => [s.id, s.listeners]))
  );
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (activeId) localStorage.setItem("litlabs_radio_station", activeId);
  }, [activeId]);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setListenerCounts((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([id, count]) => [
            id,
            Math.max(10, count + Math.floor(Math.random() * 11) - 5),
          ])
        )
      );
    }, 5000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const activeStation = RADIO.find((s) => s.id === activeId) ?? null;

  const selectStation = (s: Station) => {
    if (activeId === s.id) {
      setPlaying((p) => !p);
    } else {
      setActiveId(s.id);
      setPlaying(true);
    }
  };

  const stop = () => setPlaying(false);

  /* ---- MINI MODE ---- */
  if (mode === "mini") {
    const s = activeStation ?? RADIO[0];
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer"
        style={{
          backgroundColor: `${T.boxBg}80`,
          border: `1px solid ${s.color}20`,
        }}
        onClick={() => selectStation(s)}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${s.color}15`, border: `1px solid ${s.color}30` }}
        >
          <Radio size={16} style={{ color: s.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold truncate" style={{ color: T.textColor }}>{s.title}</span>
            <LiveBadge active={playing && activeId === s.id} />
          </div>
          <div className="text-[10px] truncate" style={{ color: T.textMuted }}>{s.nowPlaying}</div>
        </div>
        <div className="flex items-center gap-2">
          <EqualizerBars active={playing && activeId === s.id} color={s.color} />
          <button
            onClick={(e) => { e.stopPropagation(); if (playing && activeId === s.id) { stop(); } else { selectStation(s); } }}
            className="p-1"
            style={{ color: s.color }}
          >
            {playing && activeId === s.id ? <Square size={13} /> : <Play size={13} />}
          </button>
        </div>
      </div>
    );
  }

  /* ---- FULL MODE ---- */
  return (
    <div className="space-y-4">
      {RADIO.map((s) => {
        const isActive = activeId === s.id;
        const isPlaying = isActive && playing;
        return (
          <div
            key={s.id}
            className="rounded-2xl p-4 transition-all cursor-pointer"
            style={{
              backgroundColor: isActive ? `${s.color}12` : `${T.boxBg}60`,
              border: `1px solid ${isActive ? s.color + "40" : T.borderColor + "20"}`,
            }}
            onClick={() => selectStation(s)}
          >
            <div className="flex items-start gap-4">
              {/* Station icon */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: `${s.color}15`,
                  border: `1px solid ${s.color}30`,
                  boxShadow: isActive ? `0 0 16px ${s.color}30` : "none",
                }}
              >
                <Radio size={22} style={{ color: s.color }} />
              </div>

              <div className="flex-1 min-w-0">
                {/* Header row */}
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-black truncate" style={{ color: T.textColor }}>{s.title}</span>
                    <span
                      className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: `${s.color}20`, color: s.color }}
                    >
                      {s.genre}
                    </span>
                    <LiveBadge active={isPlaying} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (isPlaying) { stop(); } else { selectStation(s); } }}
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all hover:scale-105"
                    style={{
                      backgroundColor: isPlaying ? s.color : `${s.color}20`,
                      color: isPlaying ? "#000" : s.color,
                      boxShadow: isPlaying ? `0 0 12px ${s.color}50` : "none",
                    }}
                  >
                    {isPlaying ? <Square size={13} /> : <Play size={13} />}
                  </button>
                </div>

                {/* Now playing */}
                <div className="text-xs truncate mb-2" style={{ color: T.textMuted }}>
                  {s.nowPlaying}
                </div>

                {/* Footer row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5" style={{ color: T.textMuted }}>
                    <Users size={11} />
                    <span className="text-[11px] font-mono">
                      {listenerCounts[s.id]?.toLocaleString() ?? s.listeners} listening
                    </span>
                  </div>
                  <EqualizerBars active={isPlaying} color={s.color} />
                </div>
              </div>
            </div>

            {/* Description — only on active */}
            {isActive && (
              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: T.textMuted }}>
                {s.description}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
