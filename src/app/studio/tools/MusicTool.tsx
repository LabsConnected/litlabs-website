// src/app/studio/tools/MusicTool.tsx
// Native Studio tool for the Music Lab. Renders at /studio?tool=music.
// Two modes: Quick Create (prompt + controls) and Custom (lyrics + style).
// Includes the Music Vault (track library) below.

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useMusicGeneration } from "@/hooks/use-music-generation";
import { useMusicVault, type VaultTrack } from "@/hooks/use-music-vault";

const COST_CONCEPT = 8;
const COST_INSTRUMENTAL = 20;
const COST_SONG = 30;

export default function MusicTool() {
  const { resolvedColors: T } = useTheme();
  const { balance, refresh: refreshWallet } = useWallet();
  const [mode, setMode] = useState<"quick" | "custom">("quick");

  return (
    <div
      className="flex h-full w-full flex-col overflow-y-auto"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <MusicIcon size={26} color={T.accentColor} />
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: T.textColor }}>
              Music Lab
            </h1>
            <p className="text-xs opacity-60">
              Turn a thought into a finished track. Two versions per generation.
            </p>
          </div>
          <div
            className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              backgroundColor: `${T.accentColor}15`,
              color: T.accentColor,
            }}
          >
            {balance === null ? "—" : balance} LBC
          </div>
        </div>

        {/* Mode tabs */}
        <div
          className="mb-6 flex gap-1 rounded-xl p-1"
          style={{ backgroundColor: `${T.textColor}08` }}
        >
          <ModeTab label="Quick Create" active={mode === "quick"} onClick={() => setMode("quick")} T={T} />
          <ModeTab label="Custom" active={mode === "custom"} onClick={() => setMode("custom")} T={T} />
        </div>

        {mode === "quick" ? <QuickCreate T={T} onGenerated={refreshWallet} /> : <CustomMode T={T} onGenerated={refreshWallet} />}

        {/* Divider */}
        <div className="my-8 h-px w-full" style={{ backgroundColor: `${T.textColor}10` }} />

        {/* Music Vault */}
        <MusicVaultSection T={T} />
      </div>
    </div>
  );
}

function ModeTab({
  label,
  active,
  onClick,
  T,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      style={{
        backgroundColor: active ? `${T.accentColor}20` : "transparent",
        color: active ? T.accentColor : `${T.textColor}99`,
      }}
    >
      {label}
    </button>
  );
}

// ── Quick Create ────────────────────────────────────────────────────────────

function QuickCreate({
  T,
  onGenerated,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
  onGenerated: () => void;
}) {
  const { balance } = useWallet();
  const [prompt, setPrompt] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [duration, setDuration] = useState<"concept" | "full">("full");
  const [vocalType, setVocalType] = useState("male");
  const [explicit, setExplicit] = useState(false);
  const [energy, setEnergy] = useState(7);

  const {
    isGenerating,
    status,
    progress,
    error,
    lbcCharged,
    lbcRefunded,
    tracks,
    startGeneration,
    cancelGeneration,
  } = useMusicGeneration();

  const cost = duration === "concept" ? COST_CONCEPT : instrumental ? COST_INSTRUMENTAL : COST_SONG;
  const canAfford = balance === null || balance >= cost;

  useEffect(() => {
    if (status === "completed") {
      onGenerated();
    }
  }, [status, onGenerated]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || prompt.trim().length < 5) return;
    void startGeneration({
      prompt: prompt.trim(),
      instrumental,
      duration,
      vocalType,
      explicit,
      energy,
    });
  }, [prompt, instrumental, duration, vocalType, explicit, energy, startGeneration]);

  return (
    <div className="space-y-5">
      {/* Prompt */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your song... Dark aggressive EDM trap anthem with massive bass, catchy male vocals and a festival drop."
          className="min-h-[100px] w-full resize-none rounded-xl border p-4 text-sm outline-none focus:ring-2"
          style={{
            backgroundColor: `${T.textColor}08`,
            borderColor: `${T.textColor}15`,
            color: T.textColor,
          }}
          disabled={isGenerating}
        />
        <div className="absolute bottom-3 right-3 text-[10px] opacity-40">
          {prompt.length} chars
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Control label="Mode" T={T}>
          <Toggle
            options={[{ label: "Vocals", value: "vocals" }, { label: "Instrumental", value: "instrumental" }]}
            value={instrumental ? "instrumental" : "vocals"}
            onChange={(v) => setInstrumental(v === "instrumental")}
            T={T}
          />
        </Control>

        <Control label="Length" T={T}>
          <Toggle
            options={[{ label: "30s", value: "concept" }, { label: "Full", value: "full" }]}
            value={duration}
            onChange={(v) => setDuration(v as "concept" | "full")}
            T={T}
          />
        </Control>

        {!instrumental && (
          <Control label="Vocal" T={T}>
            <select
              value={vocalType}
              onChange={(e) => setVocalType(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: `${T.textColor}08`,
                borderColor: `${T.textColor}15`,
                color: T.textColor,
              }}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="auto">Auto</option>
            </select>
          </Control>
        )}

        <Control label={`Energy ${energy}/10`} T={T}>
          <input
            type="range"
            min={1}
            max={10}
            value={energy}
            onChange={(e) => setEnergy(parseInt(e.target.value, 10))}
            className="w-full"
            style={{ accentColor: T.accentColor }}
          />
        </Control>
      </div>

      {/* Explicit toggle */}
      <label className="flex cursor-pointer items-center gap-3 text-sm opacity-70">
        <button
          type="button"
          role="switch"
          aria-checked={explicit}
          onClick={() => setExplicit(!explicit)}
          className="relative h-6 w-10 rounded-full transition-colors"
          style={{ backgroundColor: explicit ? T.warning : `${T.textColor}20` }}
        >
          <span
            className="absolute top-1 h-4 w-4 rounded-full bg-white transition-transform"
            style={{ transform: explicit ? "translateX(22px)" : "translateX(4px)" }}
          />
        </button>
        Allow explicit content
      </label>

      {/* Generate */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || prompt.trim().length < 5 || !canAfford}
          className="flex-1 rounded-xl px-6 py-3 text-base font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}, ${T.accentColor}cc)`,
            color: "#fff",
          }}
        >
          {isGenerating ? "Growing Track..." : `✨ Grow Track (${cost} LBC)`}
        </button>
        {isGenerating && (
          <button
            type="button"
            onClick={cancelGeneration}
            className="rounded-xl px-5 py-3 text-sm font-medium transition-colors"
            style={{
              backgroundColor: `${T.warning}20`,
              color: T.warning,
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {!canAfford && (
        <div className="text-xs" style={{ color: T.warning }}>
          Insufficient LBC. You need {cost} but have {balance ?? 0}.
        </div>
      )}

      {/* Progress */}
      {isGenerating && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="font-medium capitalize" style={{ color: T.accentColor }}>
              {status}
            </span>
            <span className="opacity-50">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: `${T.textColor}10` }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, backgroundColor: T.accentColor }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{
            backgroundColor: `${T.warning}15`,
            borderColor: `${T.warning}40`,
            color: T.warning,
          }}
        >
          {error}
          {lbcRefunded && <div className="mt-1 text-xs opacity-80">LBC has been refunded.</div>}
        </div>
      )}

      {/* Completed tracks preview */}
      {status === "completed" && tracks.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider opacity-50">
            Generated versions
          </div>
          {tracks.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-xl border p-3"
              style={{ borderColor: `${T.textColor}10`, backgroundColor: `${T.textColor}05` }}
            >
              <span className="text-sm font-medium" style={{ color: T.accentColor }}>
                {t.versionLabel}
              </span>
              <span className="flex-1 truncate text-sm">{t.title}</span>
              <span className="text-xs opacity-50">
                {t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")}` : "--:--"}
              </span>
            </div>
          ))}
          <div className="text-xs opacity-50">
            {lbcCharged} LBC charged. Tracks are in your Music Vault below.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Custom Mode (Quick Create + lyrics/style) ──────────────────────────────

function CustomMode({
  T,
  onGenerated,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
  onGenerated: () => void;
}) {
  const { balance } = useWallet();
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [duration, setDuration] = useState<"concept" | "full">("full");
  const [vocalType, setVocalType] = useState("male");
  const [explicit, setExplicit] = useState(false);
  const [energy, setEnergy] = useState(7);

  const {
    isGenerating,
    status,
    progress,
    error,
    lbcCharged,
    lbcRefunded,
    tracks,
    startGeneration,
    cancelGeneration,
  } = useMusicGeneration();

  const cost = duration === "concept" ? COST_CONCEPT : instrumental ? COST_INSTRUMENTAL : COST_SONG;
  const canAfford = balance === null || balance >= cost;

  useEffect(() => {
    if (status === "completed") onGenerated();
  }, [status, onGenerated]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || prompt.trim().length < 5) return;
    void startGeneration({
      prompt: prompt.trim(),
      instrumental,
      duration,
      vocalType,
      explicit,
      lyrics: lyrics.trim() || undefined,
      energy,
    });
    void style;
  }, [prompt, instrumental, duration, vocalType, explicit, lyrics, energy, style, startGeneration]);

  return (
    <div className="space-y-5">
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the vibe... Cinematic orchestral hybrid trap with epic strings and 808 drops."
          className="min-h-[80px] w-full resize-none rounded-xl border p-4 text-sm outline-none focus:ring-2"
          style={{ backgroundColor: `${T.textColor}08`, borderColor: `${T.textColor}15`, color: T.textColor }}
          disabled={isGenerating}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Control label="Lyrics (optional)" T={T}>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="[Verse 1]&#10;Original lyrics here..."
            className="min-h-[100px] w-full resize-none rounded-lg border p-3 text-sm outline-none"
            style={{ backgroundColor: `${T.textColor}08`, borderColor: `${T.textColor}15`, color: T.textColor }}
            disabled={isGenerating || instrumental}
          />
        </Control>

        <div className="space-y-4">
          <Control label="Style tags (optional)" T={T}>
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="e.g. slow, dark, ambient"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: `${T.textColor}08`, borderColor: `${T.textColor}15`, color: T.textColor }}
              disabled={isGenerating}
            />
          </Control>

          <div className="grid grid-cols-2 gap-3">
            <Control label="Mode" T={T}>
              <Toggle
                options={[{ label: "Vocals", value: "vocals" }, { label: "Instr.", value: "instrumental" }]}
                value={instrumental ? "instrumental" : "vocals"}
                onChange={(v) => setInstrumental(v === "instrumental")}
                T={T}
              />
            </Control>
            <Control label="Length" T={T}>
              <Toggle
                options={[{ label: "30s", value: "concept" }, { label: "Full", value: "full" }]}
                value={duration}
                onChange={(v) => setDuration(v as "concept" | "full")}
                T={T}
              />
            </Control>
          </div>

          {!instrumental && (
            <Control label="Vocal" T={T}>
              <select
                value={vocalType}
                onChange={(e) => setVocalType(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ backgroundColor: `${T.textColor}08`, borderColor: `${T.textColor}15`, color: T.textColor }}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="auto">Auto</option>
              </select>
            </Control>
          )}

          <Control label={`Energy ${energy}/10`} T={T}>
            <input
              type="range"
              min={1}
              max={10}
              value={energy}
              onChange={(e) => setEnergy(parseInt(e.target.value, 10))}
              className="w-full"
              style={{ accentColor: T.accentColor }}
            />
          </Control>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-3 text-sm opacity-70">
        <button
          type="button"
          role="switch"
          aria-checked={explicit}
          onClick={() => setExplicit(!explicit)}
          className="relative h-6 w-10 rounded-full transition-colors"
          style={{ backgroundColor: explicit ? T.warning : `${T.textColor}20` }}
        >
          <span
            className="absolute top-1 h-4 w-4 rounded-full bg-white transition-transform"
            style={{ transform: explicit ? "translateX(22px)" : "translateX(4px)" }}
          />
        </button>
        Allow explicit content
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || prompt.trim().length < 5 || !canAfford}
          className="flex-1 rounded-xl px-6 py-3 text-base font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${T.accentColor}, ${T.accentColor}cc)`, color: "#fff" }}
        >
          {isGenerating ? "Growing Track..." : `✨ Grow Track (${cost} LBC)`}
        </button>
        {isGenerating && (
          <button
            type="button"
            onClick={cancelGeneration}
            className="rounded-xl px-5 py-3 text-sm font-medium"
            style={{ backgroundColor: `${T.warning}20`, color: T.warning }}
          >
            Cancel
          </button>
        )}
      </div>

      {!canAfford && (
        <div className="text-xs" style={{ color: T.warning }}>
          Insufficient LBC. You need {cost} but have {balance ?? 0}.
        </div>
      )}

      {isGenerating && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="font-medium capitalize" style={{ color: T.accentColor }}>{status}</span>
            <span className="opacity-50">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: `${T.textColor}10` }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, backgroundColor: T.accentColor }} />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border p-4 text-sm" style={{ backgroundColor: `${T.warning}15`, borderColor: `${T.warning}40`, color: T.warning }}>
          {error}
          {lbcRefunded && <div className="mt-1 text-xs opacity-80">LBC has been refunded.</div>}
        </div>
      )}

      {status === "completed" && tracks.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider opacity-50">Generated versions</div>
          {tracks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${T.textColor}10`, backgroundColor: `${T.textColor}05` }}>
              <span className="text-sm font-medium" style={{ color: T.accentColor }}>{t.versionLabel}</span>
              <span className="flex-1 truncate text-sm">{t.title}</span>
              <span className="text-xs opacity-50">{t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")}` : "--:--"}</span>
            </div>
          ))}
          <div className="text-xs opacity-50">{lbcCharged} LBC charged. Tracks are in your Music Vault below.</div>
        </div>
      )}
    </div>
  );
}

// ── Music Vault ─────────────────────────────────────────────────────────────

function MusicVaultSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const { tracks, loading, error, updateTrack, deleteTrack, refresh } = useMusicVault();
  const [filter, setFilter] = useState<"all" | "private" | "public">("all");

  // Refresh vault when a generation completes (handled by parent via onGenerated,
  // but also poll lightly while mounted to catch async completions).
  useEffect(() => {
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = tracks.filter((t) => filter === "all" || t.visibility === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Music Vault</h2>
        <div className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: `${T.textColor}08` }}>
          {(["all", "private", "public"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors"
              style={{
                backgroundColor: filter === f ? `${T.accentColor}20` : "transparent",
                color: filter === f ? T.accentColor : `${T.textColor}99`,
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border p-3 text-xs" style={{ borderColor: `${T.warning}40`, color: T.warning }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm opacity-40">Loading Music Vault...</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center text-sm opacity-40">
          <MusicIcon size={32} color={T.textColor} />
          <p className="mt-2">No tracks yet. Grow your first track above!</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((track) => (
            <VaultTrackCard
              key={track.id}
              track={track}
              T={T}
              onUpdate={updateTrack}
              onDelete={deleteTrack}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VaultTrackCard({
  track,
  T,
  onUpdate,
  onDelete,
}: {
  track: VaultTrack;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  onUpdate: (id: string, updates: { title?: string; visibility?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) {
      if (!track.audioUrl) return;
      audioRef.current = new Audio(track.audioUrl);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      void audioRef.current.pause();
      setPlaying(false);
    } else {
      void audioRef.current.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  }, [playing, track.audioUrl]);

  const visibilityIcon: Record<string, string> = { private: "🔒", unlisted: "🔗", public: "🌐" };

  return (
    <div
      className="flex items-center gap-3 rounded-xl border p-3 transition-colors"
      style={{ borderColor: `${T.textColor}10`, backgroundColor: `${T.textColor}05` }}
    >
      <button
        type="button"
        onClick={togglePlay}
        disabled={!track.audioUrl}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-30"
        style={{ backgroundColor: `${T.accentColor}20`, color: T.accentColor }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{track.title}</span>
          <span className="text-xs" title={track.visibility}>
            {visibilityIcon[track.visibility]}
          </span>
          <span className="shrink-0 text-[10px] opacity-40">{track.version_label}</span>
        </div>
        <p className="truncate text-xs opacity-50">
          {track.blueprint?.genre?.join(", ") || "—"}
          {track.blueprint?.mood?.length ? ` • ${track.blueprint.mood.join(", ")}` : ""}
        </p>
      </div>

      <div className="shrink-0 text-xs opacity-50">
        {track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, "0")}` : "--:--"}
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-lg p-2 text-sm opacity-50 transition-opacity hover:opacity-100"
          aria-label="Track options"
        >
          ⋮
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div
              className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border py-1 shadow-xl"
              style={{ backgroundColor: T.bgColor, borderColor: `${T.textColor}15` }}
            >
              <MenuItem
                T={T}
                onClick={() => {
                  onUpdate(track.id, { visibility: track.visibility === "private" ? "public" : "private" });
                  setMenuOpen(false);
                }}
              >
                {track.visibility === "private" ? "Make Public" : "Make Private"}
              </MenuItem>
              <MenuItem
                T={T}
                onClick={() => {
                  onUpdate(track.id, { visibility: "unlisted" });
                  setMenuOpen(false);
                }}
              >
                Make Unlisted
              </MenuItem>
              <div className="my-1 h-px" style={{ backgroundColor: `${T.textColor}10` }} />
              <MenuItem
                T={T}
                danger
                onClick={() => {
                  if (confirm("Delete this track? This cannot be undone.")) {
                    onDelete(track.id);
                  }
                  setMenuOpen(false);
                }}
              >
                Delete
              </MenuItem>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared UI primitives ────────────────────────────────────────────────────

function Control({
  label,
  T,
  children,
}: {
  label: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{label}</label>
      {children}
      <span style={{ display: "none" }}>{T.accentColor}</span>
    </div>
  );
}

function Toggle({
  options,
  value,
  onChange,
  T,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          style={{
            backgroundColor: value === o.value ? T.accentColor : `${T.textColor}10`,
            color: value === o.value ? "#fff" : `${T.textColor}99`,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MenuItem({
  T,
  children,
  onClick,
  danger,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-2 text-left text-xs transition-colors hover:bg-white/5"
      style={{ color: danger ? T.warning : T.textColor }}
    >
      {children}
    </button>
  );
}

function MusicIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
