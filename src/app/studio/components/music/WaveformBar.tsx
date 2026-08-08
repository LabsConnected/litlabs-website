"use client";

/**
 * WaveformBar — lightweight waveform visualization.
 *
 * Renders a row of bars from `peaks` (0..1). If no peaks are available,
 * falls back to a deterministic pseudo-random pattern seeded from `seedId`
 * so each track gets a stable, recognizable shape without storing data.
 *
 * When `progress` (0..1) and `onSeek` are provided, the bar acts as a
 * seekable progress surface — click/drag to seek.
 */

import { useCallback, useRef, type CSSProperties } from "react";

interface WaveformBarProps {
  peaks?: number[];
  seedId?: string;
  progress?: number; // 0..1
  onSeek?: (fraction: number) => void;
  height?: number;
  bars?: number;
  accent?: string;
  style?: CSSProperties;
  /** Show a thin playhead line instead of filled bars (compact mode). */
  compact?: boolean;
}

function seededPeaks(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // xorshift-ish
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    // Shape: emphasize mids, taper edges, range 0.2..1
    const base = (h % 1000) / 1000;
    const env = 0.55 + 0.45 * Math.sin((i / count) * Math.PI);
    out.push(Math.max(0.12, Math.min(1, base * env + 0.15)));
  }
  return out;
}

export default function WaveformBar({
  peaks,
  seedId = "wave",
  progress,
  onSeek,
  height = 36,
  bars = 64,
  accent = "#a855f7",
  style,
  compact = false,
}: WaveformBarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const data = peaks && peaks.length > 0 ? peaks.slice(0, bars) : seededPeaks(seedId, bars);
  // Normalize peaks to 0..1 if they appear unnormalized.
  const maxPeak = data.reduce((m, v) => Math.max(m, v), 0);
  const norm = maxPeak > 1 ? data.map((v) => v / maxPeak) : data;
  const pct = typeof progress === "number" ? Math.max(0, Math.min(1, progress)) : 0;

  const handleSeekFromEvent = useCallback(
    (clientX: number) => {
      if (!onSeek || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const frac = (clientX - rect.left) / rect.width;
      onSeek(Math.max(0, Math.min(1, frac)));
    },
    [onSeek],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!onSeek) return;
      handleSeekFromEvent(e.clientX);
      const move = (ev: MouseEvent) => handleSeekFromEvent(ev.clientX);
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [onSeek, handleSeekFromEvent],
  );

  if (compact) {
    return (
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        style={{
          position: "relative",
          height,
          width: "100%",
          cursor: onSeek ? "pointer" : "default",
          borderRadius: 4,
          overflow: "hidden",
          background: "rgba(255,255,255,0.04)",
          ...style,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct * 100}%`,
            background: `linear-gradient(90deg, ${accent}aa, ${accent})`,
            transition: "width 0.1s linear",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${pct * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
            transform: "translateX(-1px)",
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        height,
        width: "100%",
        cursor: onSeek ? "pointer" : "default",
        ...style,
      }}
    >
      {norm.map((v, i) => {
        const active = i / norm.length <= pct;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(8, v * 100)}%`,
              minWidth: 2,
              borderRadius: 2,
              background: active ? accent : "rgba(255,255,255,0.14)",
              opacity: active ? 0.95 : 0.5,
              transition: "background 0.15s",
            }}
          />
        );
      })}
    </div>
  );
}
