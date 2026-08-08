"use client";

/**
 * FloatingMusicWidget — a draggable floating mini-player for the dashboard.
 *
 * Inspired by the LiTTree Music Player's FloatingWidget. Shows a collapsed
 * logo button when idle; expands to a mini-player panel with artwork,
 * visualizer bars, progress, and transport controls. Reads from the global
 * MusicPlayerContext so it shares state with the dashboard MusicPlayerWidget
 * and the Studio's PersistentMusicPlayer.
 */

import { useState, useRef, useCallback } from "react";
import { useMusicPlayer } from "@/context/MusicPlayerContext";
import { D } from "@/lib/dashboard/tokens";

export default function FloatingMusicWidget() {
  const player = useMusicPlayer();
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 20, y: 20 });
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const [hasMoved, setHasMoved] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    setHasMoved(false);
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - dragStart.current.mx;
      const dy = ev.clientY - dragStart.current.my;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setHasMoved(true);
      setPos({
        x: Math.max(8, dragStart.current.px - dx),
        y: Math.max(8, dragStart.current.py - dy),
      });
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  // Don't render if no track has ever been loaded
  const track = player.current;
  const accent = D.accentCyan;
  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  if (!track && !player.loadingUrl) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: pos.x,
        bottom: pos.y,
        zIndex: 150,
        userSelect: "none",
      }}
    >
      {expanded && track ? (
        /* ── Expanded mini panel ── */
        <div
          className="float-enter"
          style={{
            width: 260,
            background: "rgba(10, 6, 22, 0.96)",
            backdropFilter: "blur(30px)",
            border: `1px solid ${D.borderStrong}`,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: `0 20px 60px rgba(0,0,0,0.7), 0 0 20px ${accent}22`,
          }}
        >
          {/* Drag handle */}
          <div
            onMouseDown={onMouseDown}
            style={{ height: 8, cursor: "grab", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 4 }}
          >
            <div style={{ width: 28, height: 3, borderRadius: 2, background: D.borderStrong }} />
          </div>

          {/* Cover + info */}
          <div style={{ position: "relative", margin: "0 10px", borderRadius: 10, overflow: "hidden" }}>
            <div
              style={{
                aspectRatio: "1.6",
                background: `linear-gradient(135deg, ${accent}30, ${accent}08)`,
                display: "grid",
                placeItems: "center",
                border: `1px solid ${accent}20`,
              }}
            >
              {/* Visualizer bars */}
              <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 36, opacity: player.isPlaying ? 1 : 0.3 }}>
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 3,
                      height: `${30 + Math.sin(i * 0.7) * 40 + Math.cos(i * 1.3) * 30}%`,
                      background: accent,
                      borderRadius: 2,
                      animation: player.isPlaying ? `dash-eq 0.${3 + (i % 5)}s ease-in-out infinite alternate` : "none",
                      transformOrigin: "bottom",
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ position: "absolute", bottom: 8, left: 10, right: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {track.title}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
                {track.version_label ?? track.provider}
              </div>
            </div>
          </div>

          {/* Progress */}
          <div style={{ padding: "8px 10px 4px" }}>
            <div
              className="cursor-pointer rounded-full"
              style={{ height: 3, background: D.border }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const frac = (e.clientX - rect.left) / rect.width;
                player.seek(frac * player.duration);
              }}
            >
              <div style={{ width: `${progress}%`, height: "100%", background: accent, borderRadius: "inherit", transition: "width 0.1s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: D.textMuted, fontVariantNumeric: "tabular-nums" }}>
              <span>{fmt(player.currentTime)}</span>
              <span>{fmt(player.duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "2px 10px 12px" }}>
            <FloatBtn onClick={player.prev}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2h2v10H3zM6 7l7-5v10z"/></svg>
            </FloatBtn>
            <button
              onClick={player.togglePlay}
              style={{
                width: 38, height: 38, borderRadius: "50%",
                background: `linear-gradient(135deg, ${accent}, ${D.accent})`,
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#000",
                boxShadow: player.isPlaying ? `0 0 14px ${accent}44` : "none",
                transition: "all 0.15s",
              }}
            >
              {player.loadingUrl ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
              ) : player.isPlaying ? (
                <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="2" width="3.5" height="10" rx="1"/><rect x="8" y="2" width="3.5" height="10" rx="1"/></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5l9 5.5-9 5.5z"/></svg>
              )}
            </button>
            <FloatBtn onClick={player.next}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><path d="M11 2H9v10h2zM8 7L1 2v10z"/></svg>
            </FloatBtn>
          </div>

          {/* Close */}
          <button
            onClick={() => setExpanded(false)}
            style={{
              position: "absolute", top: 8, right: 8,
              background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%",
              width: 20, height: 20, cursor: "pointer", color: D.textMuted,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l8 8M9 1L1 9"/></svg>
          </button>
        </div>
      ) : (
        /* ── Collapsed launcher button ── */
        <button
          onMouseDown={onMouseDown}
          onClick={() => { if (!hasMoved) setExpanded(true); }}
          style={{
            width: 52, height: 52, borderRadius: "50%",
            padding: 0, border: `2px solid ${player.isPlaying ? accent : D.borderStrong}`,
            cursor: "pointer", overflow: "hidden",
            boxShadow: player.isPlaying ? `0 0 14px ${accent}44, 0 8px 24px rgba(0,0,0,0.6)` : "0 8px 24px rgba(0,0,0,0.5)",
            transition: "all 0.25s",
            background: "rgba(10, 6, 22, 0.95)",
            backdropFilter: "blur(12px)",
            display: "grid",
            placeItems: "center",
            position: "relative",
          }}
          title="LiTTree Player"
        >
          {player.isPlaying ? (
            <div style={{ display: "flex", gap: 2.5, alignItems: "flex-end", height: 18 }}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 3, borderRadius: 2, background: accent,
                    height: "40%",
                    animation: `dash-eq 0.${3 + i}s ease-in-out infinite alternate`,
                    transformOrigin: "bottom",
                  }}
                />
              ))}
            </div>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill={accent}><path d="M6 3l12 7-12 7z"/></svg>
          )}
          {player.isPlaying && (
            <div style={{
              position: "absolute", inset: -4, borderRadius: "50%",
              border: `1.5px solid ${accent}`,
              animation: "pulse 2s ease-in-out infinite",
              pointerEvents: "none",
            }} />
          )}
        </button>
      )}
    </div>
  );
}

function FloatBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 28, height: 28, borderRadius: "50%",
        background: "rgba(255,255,255,0.06)", border: "none",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        color: D.textMuted, transition: "all 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = D.textPrimary)}
      onMouseLeave={(e) => (e.currentTarget.style.color = D.textMuted)}
    >
      {children}
    </button>
  );
}

function fmt(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
