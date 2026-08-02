"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CSSProperties } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useMusicGeneration } from "@/hooks/use-music-generation";
import { useMusicVault, type VaultTrack } from "@/hooks/use-music-vault";
import {
  Music,
  Wand2,
  Download,
  RefreshCw,
  Coins,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Play,
  Pause,
  Trash2,
  X,
  Mic,
  Volume2,
  Clock,
  Eye,
  EyeOff,
  Globe,
  Plus,
} from "lucide-react";

const MUSIC_LBC_COST = {
  concept: 8,
  instrumentalFull: 20,
  songFull: 30,
};

const VOCAL_TYPES = [
  { id: "male", label: "Male", desc: "Deep & resonant" },
  { id: "female", label: "Female", desc: "Warm & clear" },
  { id: "choir", label: "Choir", desc: "Layered harmonies" },
  { id: "rap", label: "Rap", desc: "Rhythmic flow" },
];

const GENRE_PRESETS = [
  "Energetic EDM festival anthem",
  "Dark trap beat with heavy 808s",
  "Dreamy lo-fi hip hop for studying",
  "Uplifting house with piano chords",
  "Aggressive techno for the club",
  "Melancholic piano ballad",
  "Epic orchestral cinematic score",
  "Chillwave retro synthwave",
];

export default function MusicTool() {
  const { resolvedColors: T } = useTheme();
  const accent = T.accentColor || "#38bdf8";
  const {
    status,
    progress,
    error: genError,
    lbcCharged,
    lbcRefunded,
    tracks: genTracks,
    isGenerating,
    startGeneration,
    cancelGeneration,
  } = useMusicGeneration();
  const { tracks: vaultTracks, loading: vaultLoading, deleteTrack, updateTrack, refresh } = useMusicVault();

  const [prompt, setPrompt] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [duration, setDuration] = useState<"concept" | "full">("concept");
  const [vocalType, setVocalType] = useState("male");
  const [explicit, setExplicit] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [energy, setEnergy] = useState(5);
  const [showLyrics, setShowLyrics] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cost = duration === "concept"
    ? MUSIC_LBC_COST.concept
    : instrumental
      ? MUSIC_LBC_COST.instrumentalFull
      : MUSIC_LBC_COST.songFull;

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || isGenerating) return;
    void startGeneration({
      prompt: prompt.trim(),
      instrumental,
      duration,
      vocalType: instrumental ? undefined : vocalType,
      explicit,
      lyrics: instrumental ? undefined : lyrics.trim() || undefined,
      energy,
    });
  }, [prompt, instrumental, duration, vocalType, explicit, lyrics, energy, isGenerating, startGeneration]);

  const handleCancel = useCallback(() => {
    void cancelGeneration();
  }, [cancelGeneration])

  const handleDelete = useCallback(async (trackId: string) => {
    if (nowPlaying === trackId) {
      audioRef.current?.pause();
      setNowPlaying(null);
    }
    await deleteTrack(trackId);
  }, [deleteTrack, nowPlaying]);

  const togglePlay = useCallback(async (track: VaultTrack) => {
    if (nowPlaying === track.id) {
      audioRef.current?.pause();
      setNowPlaying(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    try {
      const res = await fetch(`/api/music/tracks/${track.id}/stream`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to get stream URL");
      const { url } = await res.json();

      const audio = new Audio(url);
      audio.crossOrigin = "anonymous";
      audio.onended = () => setNowPlaying(null);
      await audio.play();
      audioRef.current = audio;
      setNowPlaying(track.id);
    } catch {
      setNowPlaying(null);
    }
  }, [nowPlaying]);

  const handleDownload = useCallback(async (track: VaultTrack) => {
    try {
      const res = await fetch(`/api/music/tracks/${track.id}/stream`, { credentials: "include" });
      if (!res.ok) return;
      const { url } = await res.json();
      const a = document.createElement("a");
      a.href = url;
      a.download = `${track.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // ignore
    }
  }, []);

  const cycleVisibility = useCallback(async (track: VaultTrack) => {
    const order: Array<"private" | "unlisted" | "public"> = ["private", "unlisted", "public"];
    const next = order[(order.indexOf(track.visibility) + 1) % order.length];
    await updateTrack(track.id, { visibility: next });
  }, [updateTrack]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // Refresh vault when generation completes
  useEffect(() => {
    if (status === "completed") {
      void refresh();
    }
  }, [status, refresh]);

  const isBusy = isGenerating || ["queued", "preparing", "generating", "processing"].includes(status);

  const labelStyle: CSSProperties = {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
  };

  const inputStyle: CSSProperties = {
    background: "var(--studio-surface)",
    border: "1px solid var(--studio-border)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    fontSize: "13px",
    padding: "8px 12px",
    outline: "none",
    width: "100%",
  };

  const btnPrimary: CSSProperties = {
    background: `linear-gradient(135deg, ${accent}, ${accent})`,
    color: "#000",
    fontWeight: 700,
    border: "none",
    borderRadius: "10px",
    padding: "10px 20px",
    cursor: isBusy || !prompt.trim() ? "not-allowed" : "pointer",
    opacity: isBusy || !prompt.trim() ? 0.5 : 1,
    fontSize: "13px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.2s",
  };

  const btnGhost: CSSProperties = {
    background: "transparent",
    border: "1px solid var(--studio-border)",
    color: "var(--text-muted)",
    borderRadius: "8px",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: "11px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  };

  const cardStyle: CSSProperties = {
    background: "var(--studio-surface)",
    border: "1px solid var(--studio-border)",
    borderRadius: "12px",
    padding: "16px",
  };

  const statusColors: Record<string, string> = {
    queued: T.textColor || "#888",
    preparing: accent,
    generating: accent,
    processing: accent,
    completed: "#22c55e",
    failed: "#ef4444",
    cancelled: "#f59e0b",
  };

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "16px" }}>
      {/* Generation Form */}
      <div style={{ ...cardStyle, marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <div style={{
            width: "32px", height: "32px", borderRadius: "8px",
            background: `linear-gradient(135deg, ${accent}20, ${accent}20)`,
            display: "grid", placeItems: "center",
          }}>
            <Music size={18} style={{ color: accent }} />
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Music Lab</div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Generate tracks with AI</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", ...labelStyle }}>
            <Coins size={12} style={{ color: accent }} />
            <span>{cost} LBC</span>
          </div>
        </div>

        {/* Prompt Input */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ ...labelStyle, marginBottom: "6px" }}>Prompt</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the music you want to generate..."
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: "60px", fontFamily: "inherit" }}
            disabled={isBusy}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
            {GENRE_PRESETS.slice(0, 4).map((preset) => (
              <button
                key={preset}
                onClick={() => setPrompt(preset)}
                style={btnGhost}
                disabled={isBusy}
              >
                <Sparkles size={10} />
                {preset.split(" ").slice(0, 3).join(" ")}...
              </button>
            ))}
          </div>
        </div>

        {/* Options Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
          {/* Duration */}
          <div>
            <div style={{ ...labelStyle, marginBottom: "6px" }}>Duration</div>
            <div style={{ display: "flex", gap: "6px" }}>
              {(["concept", "full"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  disabled={isBusy}
                  style={{
                    ...btnGhost,
                    flex: 1,
                    justifyContent: "center",
                    background: duration === d ? `${accent}15` : "transparent",
                    borderColor: duration === d ? accent : "var(--studio-border)",
                    color: duration === d ? accent : "var(--text-muted)",
                  }}
                >
                  <Clock size={11} />
                  {d === "concept" ? "30s" : "2m+"}
                </button>
              ))}
            </div>
          </div>

          {/* Instrumental */}
          <div>
            <div style={{ ...labelStyle, marginBottom: "6px" }}>Mode</div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                onClick={() => setInstrumental(false)}
                disabled={isBusy}
                style={{
                  ...btnGhost, flex: 1, justifyContent: "center",
                  background: !instrumental ? `${accent}15` : "transparent",
                  borderColor: !instrumental ? accent : "var(--studio-border)",
                  color: !instrumental ? accent : "var(--text-muted)",
                }}
              >
                <Mic size={11} />
                Vocals
              </button>
              <button
                onClick={() => setInstrumental(true)}
                disabled={isBusy}
                style={{
                  ...btnGhost, flex: 1, justifyContent: "center",
                  background: instrumental ? `${accent}15` : "transparent",
                  borderColor: instrumental ? accent : "var(--studio-border)",
                  color: instrumental ? accent : "var(--text-muted)",
                }}
              >
                <Music size={11} />
                Instrumental
              </button>
            </div>
          </div>

          {/* Energy */}
          <div>
            <div style={{ ...labelStyle, marginBottom: "6px" }}>Energy: {energy}</div>
            <input
              type="range"
              min={1}
              max={10}
              value={energy}
              onChange={(e) => setEnergy(Number(e.target.value))}
              disabled={isBusy}
              style={{ width: "100%", accentColor: accent }}
            />
          </div>
        </div>

        {/* Vocal Type (if vocals) */}
        {!instrumental && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ ...labelStyle, marginBottom: "6px" }}>Vocal Type</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {VOCAL_TYPES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVocalType(v.id)}
                  disabled={isBusy}
                  style={{
                    ...btnGhost,
                    background: vocalType === v.id ? `${accent}15` : "transparent",
                    borderColor: vocalType === v.id ? accent : "var(--studio-border)",
                    color: vocalType === v.id ? accent : "var(--text-muted)",
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lyrics (collapsible) */}
        {!instrumental && (
          <div style={{ marginBottom: "12px" }}>
            <button
              onClick={() => setShowLyrics(!showLyrics)}
              style={{ ...btnGhost, marginBottom: showLyrics ? "6px" : 0 }}
            >
              {showLyrics ? <X size={11} /> : <Plus size={11} />}
              Custom Lyrics
            </button>
            {showLyrics && (
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="Enter custom lyrics (optional)..."
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: "80px", fontFamily: "inherit" }}
                disabled={isBusy}
              />
            )}
          </div>
        )}

        {/* Explicit toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <button
            onClick={() => setExplicit(!explicit)}
            disabled={isBusy}
            style={{
              ...btnGhost,
              background: explicit ? "#ef444415" : "transparent",
              borderColor: explicit ? "#ef4444" : "var(--studio-border)",
              color: explicit ? "#ef4444" : "var(--text-muted)",
            }}
          >
            <AlertTriangle size={11} />
            Explicit Content
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={handleGenerate} style={btnPrimary} disabled={isBusy || !prompt.trim()}>
            {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {isBusy ? "Generating..." : `Generate (${cost} LBC)`}
          </button>
          {isBusy && (
            <button onClick={handleCancel} style={{ ...btnGhost, borderColor: "#ef4444", color: "#ef4444" }}>
              <X size={12} />
              Cancel
            </button>
          )}
        </div>

        {/* Progress Bar */}
        {isBusy && (
          <div style={{ marginTop: "12px" }}>
            <div style={{
              height: "4px",
              background: "var(--studio-border)",
              borderRadius: "2px",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${progress}%`,
                background: `linear-gradient(90deg, ${accent}, ${accent})`,
                transition: "width 0.5s ease",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "capitalize" }}>
                {status}
              </span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{progress}%</span>
            </div>
          </div>
        )}

        {/* Error / Refund Notice */}
        {genError && (
          <div style={{
            marginTop: "12px",
            padding: "10px 12px",
            background: "#ef444410",
            border: "1px solid #ef444430",
            borderRadius: "8px",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
          }}>
            <AlertTriangle size={14} style={{ color: "#ef4444", flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "12px", color: "#ef4444", fontWeight: 600 }}>{genError}</div>
              {lbcRefunded && (
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: 2 }}>
                  Your {lbcCharged} LBC has been refunded.
                </div>
              )}
              {!isBusy && prompt.trim() && (
                <button
                  onClick={handleGenerate}
                  style={{ ...btnGhost, marginTop: 8, borderColor: "#ef4444", color: "#ef4444" }}
                >
                  <RefreshCw size={11} />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Success Notice */}
        {status === "completed" && genTracks.length > 0 && (
          <div style={{
            marginTop: "12px",
            padding: "10px 12px",
            background: "#22c55e10",
            border: "1px solid #22c55e30",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
            <span style={{ fontSize: "12px", color: "#22c55e", fontWeight: 600 }}>
              Generated {genTracks.length} track{genTracks.length > 1 ? "s" : ""}! Scroll down to listen.
            </span>
          </div>
        )}
      </div>

      {/* Track Vault */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <Volume2 size={14} style={{ color: accent }} />
          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>Your Tracks</span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            ({vaultTracks.length})
          </span>
          <button onClick={() => void refresh()} style={{ ...btnGhost, marginLeft: "auto", padding: "4px 8px" }}>
            <RefreshCw size={11} />
          </button>
        </div>

        {vaultLoading ? (
          <div style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)", fontSize: "12px" }}>
            <Loader2 size={20} className="animate-spin" style={{ margin: "0 auto 8px" }} />
            Loading tracks...
          </div>
        ) : vaultTracks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
            <Music size={28} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>No tracks yet</div>
            <div style={{ fontSize: "11px" }}>Generate your first track above</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {vaultTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isPlaying={nowPlaying === track.id}
                onTogglePlay={() => void togglePlay(track)}
                onDelete={() => void handleDelete(track.id)}
                onDownload={() => void handleDownload(track)}
                onCycleVisibility={() => void cycleVisibility(track)}
                accentColor={accent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrackRow({
  track,
  isPlaying,
  onTogglePlay,
  onDelete,
  onDownload,
  onCycleVisibility,
  accentColor,
}: {
  track: VaultTrack;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onCycleVisibility: () => void;
  accentColor: string;
}) {
  const visIcon = track.visibility === "public" ? Globe : track.visibility === "unlisted" ? Eye : EyeOff;
  const VisIcon = visIcon;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "10px 12px",
      background: "var(--studio-surface)",
      border: "1px solid var(--studio-border)",
      borderRadius: "10px",
      transition: "border-color 0.2s",
    }}>
      {/* Play/Pause */}
      <button
        onClick={onTogglePlay}
        style={{
          width: "32px", height: "32px", borderRadius: "8px",
          background: `${accentColor}15`, border: "none",
          display: "grid", placeItems: "center", cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {isPlaying ? <Pause size={14} style={{ color: accentColor }} /> : <Play size={14} style={{ color: accentColor }} />}
      </button>

      {/* Track Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "12px", fontWeight: 600, color: "var(--text-primary)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {track.title}
        </div>
        <div style={{ display: "flex", gap: "8px", fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
          <span>{track.version_label}</span>
          {track.duration ? <span>{Math.floor(track.duration / 60)}:{String(Math.floor(track.duration % 60)).padStart(2, "0")}</span> : null}
          {track.bpm ? <span>{track.bpm} BPM</span> : null}
          <span style={{ textTransform: "capitalize" }}>{track.provider}</span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
        <button onClick={onCycleVisibility} title={`Visibility: ${track.visibility}`} style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: "4px", borderRadius: "6px", color: "var(--text-muted)",
        }}>
          <VisIcon size={13} />
        </button>
        <button onClick={onDownload} title="Download" style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: "4px", borderRadius: "6px", color: "var(--text-muted)",
        }}>
          <Download size={13} />
        </button>
        <button onClick={onDelete} title="Delete" style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: "4px", borderRadius: "6px", color: "var(--text-muted)",
        }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
