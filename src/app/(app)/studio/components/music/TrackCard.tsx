"use client";

/**
 * TrackCard — rich generation card for the Music studio.
 *
 * Cover art (gradient + initial), title, metadata line (genre · BPM · key ·
 * duration), waveform, primary actions (Play, Remix, Extend, Edit, Lyrics)
 * and a "⋯" overflow menu (Download, Rename, Duplicate, Share, Delete).
 *
 * Play taps into the persistent MusicPlayerContext so audio survives tool
 * switches.
 */

import { useState, useCallback, useRef, useEffect, type CSSProperties } from "react";
import {
  Play,
  Pause,
  Download,
  Trash2,
  MoreHorizontal,
  Pencil,
  Share2,
  Layers,
  Wand2,
  Clock,
  Mic,
  Music as MusicIcon,
  Loader2,
  Check,
} from "lucide-react";
import { useMusicPlayer } from "@/context/MusicPlayerContext";
import type { VaultTrack } from "@/hooks/use-music-vault";
import WaveformBar from "./WaveformBar";

interface TrackCardProps {
  track: VaultTrack;
  accent: string;
  onRemix: (track: VaultTrack) => void;
  onExtend: (track: VaultTrack) => void;
  onEditLyrics: (track: VaultTrack) => void;
  onRename: (track: VaultTrack, title: string) => void;
  onDelete: (track: VaultTrack) => void;
  onDownload: (track: VaultTrack) => void;
  onShare: (track: VaultTrack) => void;
  onDuplicate: (track: VaultTrack) => void;
  onUseAsStyle: (track: VaultTrack) => void;
  queue?: VaultTrack[];
}

function formatDuration(s?: number | null): string {
  if (!s) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function coverGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue}, 70%, 28%), hsl(${(hue + 40) % 360}, 65%, 18%))`;
}

export default function TrackCard({
  track,
  accent,
  onRemix,
  onExtend,
  onEditLyrics,
  onRename,
  onDelete,
  onDownload,
  onShare,
  onDuplicate,
  onUseAsStyle,
  queue,
}: TrackCardProps) {
  const player = useMusicPlayer();
  const isCurrent = player.current?.id === track.id;
  const isPlaying = isCurrent && player.isPlaying;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(track.title);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const handlePlay = useCallback(() => {
    if (isCurrent) {
      player.togglePlay();
    } else {
      player.playTrack(
        {
          id: track.id,
          title: track.title,
          version_label: track.version_label,
          duration: track.duration,
          bpm: track.bpm,
          musical_key: track.musical_key,
          visibility: track.visibility,
          blueprint: track.blueprint,
          provider: track.provider,
          created_at: track.created_at,
        },
        queue
          ? queue.map((t) => ({
              id: t.id,
              title: t.title,
              version_label: t.version_label,
              duration: t.duration,
              bpm: t.bpm,
              musical_key: t.musical_key,
              visibility: t.visibility,
              blueprint: t.blueprint,
              provider: t.provider,
              created_at: t.created_at,
            }))
          : undefined,
      );
    }
  }, [isCurrent, player, track, queue]);

  const submitRename = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== track.title) {
      onRename(track, trimmed);
    }
    setRenaming(false);
  }, [name, track, onRename]);

  const genre = track.blueprint?.genre?.[0] ?? track.provider;
  const meta = [
    genre,
    track.bpm ? `${track.bpm} BPM` : null,
    track.musical_key ?? null,
    formatDuration(track.duration),
  ].filter(Boolean);

  const cardStyle: CSSProperties = {
    background: "var(--studio-surface)",
    border: `1px solid ${isCurrent ? `${accent}55` : "var(--studio-border)"}`,
    borderRadius: 14,
    padding: 14,
    transition: "border-color 0.2s, transform 0.2s",
    boxShadow: isCurrent ? `0 0 0 1px ${accent}22, 0 8px 24px rgba(0,0,0,0.25)` : "none",
  };

  const actionBtn: CSSProperties = {
    background: "transparent",
    border: "1px solid var(--studio-border)",
    color: "var(--text-secondary)",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 5,
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Cover art */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 12,
            background: coverGradient(track.id),
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            position: "relative",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {track.blueprint?.instrumental ? (
            <MusicIcon size={26} style={{ color: "rgba(255,255,255,0.7)" }} />
          ) : (
            <Mic size={26} style={{ color: "rgba(255,255,255,0.7)" }} />
          )}
          <button
            onClick={handlePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              border: "none",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              opacity: 0,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = isPlaying ? "0.6" : "0")}
          >
            {player.loadingUrl && isCurrent ? (
              <Loader2 size={22} className="animate-spin" style={{ color: "#fff" }} />
            ) : isPlaying ? (
              <Pause size={22} style={{ color: "#fff" }} />
            ) : (
              <Play size={22} style={{ color: "#fff" }} />
            )}
          </button>
        </div>

        {/* Title + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <div style={{ display: "flex", gap: 4 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                autoFocus
                style={{
                  background: "var(--studio-bg)",
                  border: `1px solid ${accent}`,
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 14,
                  fontWeight: 800,
                  padding: "3px 8px",
                  outline: "none",
                  width: "100%",
                }}
              />
              <button onClick={submitRename} style={{ ...actionBtn, padding: "4px 6px" }} aria-label="Confirm rename">
                <Check size={13} style={{ color: accent }} />
              </button>
            </div>
          ) : (
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {track.title}
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 3,
              flexWrap: "wrap",
              textTransform: "capitalize",
            }}
          >
            {meta.map((m, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                {m}
                {i < meta.length - 1 && <span style={{ opacity: 0.4 }}>·</span>}
              </span>
            ))}
          </div>

          {/* Waveform */}
          <div style={{ marginTop: 8 }}>
            <WaveformBar
              seedId={track.id}
              progress={isCurrent && player.duration ? player.currentTime / player.duration : 0}
              onSeek={isCurrent ? (frac) => player.seek(frac * player.duration) : undefined}
              height={28}
              bars={48}
              accent={accent}
            />
          </div>
        </div>

        {/* Overflow menu */}
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More actions"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 6,
              borderRadius: 6,
              color: "var(--text-muted)",
            }}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "100%",
                marginTop: 4,
                zIndex: 50,
                minWidth: 168,
                background: "var(--studio-surface)",
                border: "1px solid var(--studio-border)",
                borderRadius: 10,
                boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                overflow: "hidden",
              }}
            >
              {[
                { label: "Download MP3", icon: Download, fn: () => onDownload(track) },
                { label: "Rename", icon: Pencil, fn: () => { setMenuOpen(false); setRenaming(true); } },
                { label: "Duplicate", icon: Layers, fn: () => onDuplicate(track) },
                { label: "Use as Style", icon: Wand2, fn: () => onUseAsStyle(track) },
                { label: "Share", icon: Share2, fn: () => onShare(track) },
                { label: "Delete", icon: Trash2, fn: () => onDelete(track), danger: true },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={() => {
                      setMenuOpen(false);
                      item.fn();
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
                      fontSize: 12,
                      fontWeight: 600,
                      color: item.danger ? "#ef4444" : "var(--text-secondary)",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Icon size={13} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Action row */}
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={handlePlay} style={actionBtn}>
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button onClick={() => onRemix(track)} style={actionBtn}>
          <Wand2 size={12} /> Remix
        </button>
        <button onClick={() => onExtend(track)} style={actionBtn}>
          <Clock size={12} /> Extend
        </button>
        <button onClick={() => onEditLyrics(track)} style={actionBtn}>
          <Pencil size={12} /> Lyrics
        </button>
      </div>
    </div>
  );
}
