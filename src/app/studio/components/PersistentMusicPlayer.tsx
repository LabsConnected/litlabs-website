"use client";

/**
 * PersistentMusicPlayer — fixed bottom transport bar for the Studio.
 *
 * Reads from MusicPlayerContext. Only renders when there is a current
 * track. Mounted once at the CommandStudio shell level so it survives
 * tool switches (Create → Library → Chat → …).
 */

import { useState, type CSSProperties } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Music as MusicIcon,
  Mic,
  Loader2,
  ListMusic,
  X,
} from "lucide-react";
import { useMusicPlayer } from "@/context/MusicPlayerContext";
import { useTheme } from "@/context/ThemeContext";
import WaveformBar from "./music/WaveformBar";

function formatTime(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function PersistentMusicPlayer() {
  const player = useMusicPlayer();
  const { resolvedColors: T } = useTheme();
  const accent = T.accentColor || "#a855f7";
  const [showQueue, setShowQueue] = useState(false);

  if (!player.current) return null;

  const t = player.current;
  const progress = player.duration ? player.currentTime / player.duration : 0;
  const instrumental = t.blueprint?.instrumental;

  const iconBtn: CSSProperties = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 6,
    borderRadius: 8,
    color: "var(--text-muted)",
    display: "grid",
    placeItems: "center",
    transition: "color 0.15s, background 0.15s",
  };

  return (
    <>
      <div
        className="shrink-0"
        style={{
          borderTop: "1px solid var(--studio-border)",
          background: "linear-gradient(180deg, var(--studio-surface), var(--studio-bg))",
          backdropFilter: "blur(12px)",
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          minHeight: 60,
        }}
        data-testid="persistent-music-player"
      >
        {/* Track info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "0 1 240px" }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${accent}40, ${accent}10)`,
              border: `1px solid ${accent}30`,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            {instrumental ? (
              <MusicIcon size={18} style={{ color: accent }} />
            ) : (
              <Mic size={18} style={{ color: accent }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t.title}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", gap: 6, marginTop: 1 }}>
              {t.version_label && <span>{t.version_label}</span>}
              {t.bpm && <span>{t.bpm} BPM</span>}
              {t.musical_key && <span>{t.musical_key}</span>}
            </div>
          </div>
        </div>

        {/* Transport + waveform */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, maxWidth: 640, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={() => player.toggleShuffle()}
              aria-label="Shuffle"
              style={{ ...iconBtn, color: player.shuffle ? accent : "var(--text-muted)" }}
            >
              <Shuffle size={14} />
            </button>
            <button onClick={player.prev} aria-label="Previous" style={iconBtn}>
              <SkipBack size={15} />
            </button>
            <button
              onClick={player.togglePlay}
              aria-label={player.isPlaying ? "Pause" : "Play"}
              style={{
                ...iconBtn,
                background: `${accent}18`,
                color: accent,
                width: 34,
                height: 34,
                borderRadius: 10,
              }}
            >
              {player.loadingUrl ? (
                <Loader2 size={16} className="animate-spin" />
              ) : player.isPlaying ? (
                <Pause size={16} />
              ) : (
                <Play size={16} />
              )}
            </button>
            <button onClick={player.next} aria-label="Next" style={iconBtn}>
              <SkipForward size={15} />
            </button>
            <button
              onClick={player.cycleRepeat}
              aria-label="Repeat"
              style={{ ...iconBtn, color: player.repeat !== "off" ? accent : "var(--text-muted)" }}
            >
              {player.repeat === "one" ? <Repeat1 size={14} /> : <Repeat size={14} />}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", minWidth: 32, textAlign: "right" }}>
              {formatTime(player.currentTime)}
            </span>
            <WaveformBar
              seedId={t.id}
              progress={progress}
              onSeek={(frac) => player.seek(frac * player.duration)}
              height={20}
              bars={80}
              accent={accent}
              compact
            />
            <span style={{ fontSize: 10, color: "var(--text-muted)", minWidth: 32 }}>
              {formatTime(player.duration)}
            </span>
          </div>
        </div>

        {/* Volume + queue */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button onClick={player.toggleMute} aria-label="Mute" style={iconBtn}>
            {player.muted || player.volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={player.muted ? 0 : player.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ width: 72, accentColor: accent, cursor: "pointer" }}
          />
          <button
            onClick={() => setShowQueue((v) => !v)}
            aria-label="Queue"
            style={{ ...iconBtn, color: showQueue ? accent : "var(--text-muted)" }}
          >
            <ListMusic size={15} />
          </button>
        </div>
      </div>

      {/* Queue popover */}
      {showQueue && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 76,
            zIndex: 9000,
            width: 320,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--studio-surface)",
            border: "1px solid var(--studio-border)",
            borderRadius: 12,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderBottom: "1px solid var(--studio-border)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-primary)" }}>Up Next</span>
            <button onClick={() => setShowQueue(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)" }} aria-label="Close queue">
              <X size={14} />
            </button>
          </div>
          {player.queue.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
              Queue is empty.
            </div>
          ) : (
            player.queue.map((qt, i) => (
              <button
                key={qt.id + i}
                onClick={() => {
                  // Jump to this track
                  if (i !== player.currentIdx) {
                    // Reuse playTrack with the existing queue
                    player.playTrack(qt, player.queue);
                  }
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontSize: 10, color: i === player.currentIdx ? accent : "var(--text-muted)", minWidth: 16 }}>
                  {i === player.currentIdx ? "▶" : i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: i === player.currentIdx ? 700 : 500,
                      color: i === player.currentIdx ? accent : "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {qt.title}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {qt.version_label ?? qt.provider}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </>
  );
}
