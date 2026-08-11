"use client";

/**
 * MediaNowPlayingCard — Dashboard media card.
 *
 * Rebuilt from URL-paste-only to a connected-provider experience:
 *   - Shows connected providers (YouTube, Spotify, Apple Music, LiTTree)
 *   - Connect/Connected buttons for each provider
 *   - Now-playing display with controls when media is active
 *   - URL paste moved to "Advanced / Paste Link" (collapsible)
 *   - LiTTree music is first-class via MusicPlayerContext
 *
 * Uses the existing MediaHubProvider + MusicPlayerContext — does NOT
 * create a new player. Just presents the existing architecture better.
 */

import { useState, useCallback } from "react";
import { useMediaHub } from "./MediaHubProvider";
import { useMusicPlayerOptional } from "@/context/MusicPlayerContext";
import { parseMediaUrl } from "./parse-media-url";
import {
  ALL_PROVIDER_IDS,
  PROVIDER_LABELS,
  PROVIDER_COLORS,
  type MediaProviderId,
} from "./media-types";

/* Provider display config — subset for the dashboard card */
const DASHBOARD_PROVIDERS: { id: MediaProviderId; connectable: boolean }[] = [
  { id: "youtube", connectable: true },
  { id: "spotify", connectable: true },
  { id: "apple-music", connectable: true },
  { id: "litt", connectable: false }, // LiTTree is always "connected"
];

export function MediaNowPlayingCard() {
  const {
    activeProvider,
    playback,
    toggle,
    next,
    previous,
    showExpanded,
    loadUrl,
    switchProvider,
  } = useMediaHub();

  const littMusic = useMusicPlayerOptional();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isPlaying = playback.status === "playing";
  const hasItem = !!playback.item;

  // LiTTree music state
  const littPlaying = littMusic?.isPlaying ?? false;
  const littTrack = littMusic?.queue?.[littMusic.currentIdx];
  const hasLittTrack = !!littTrack;

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setError(null);
    try {
      parseMediaUrl(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid URL");
      return;
    }
    const ok = loadUrl(input);
    if (!ok) {
      setError("Could not load this URL.");
      return;
    }
    setInput("");
  }, [input, loadUrl]);

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: "var(--studio-border)",
        background: "linear-gradient(135deg, rgba(0,0,0,0.35), rgba(124,58,237,0.03))",
        backdropFilter: "blur(20px)",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-black" style={{ color: "var(--text-primary)" }}>
          Media
        </h3>
        <button
          type="button"
          onClick={showExpanded}
          className="text-[10px] font-bold transition hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          Expand →
        </button>
      </div>

      {/* Now Playing (if active media) */}
      {hasItem && (
        <div className="mb-3 rounded-xl border p-3" style={{ borderColor: "var(--studio-border)", background: "rgba(0,0,0,0.2)" }}>
          {playback.item?.artworkUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- remote artwork */
            <img src={playback.item.artworkUrl} alt="" className="mb-2 w-full rounded-lg" style={{ aspectRatio: "16 / 9", objectFit: "cover" }} />
          )}
          <p className="truncate text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
            {playback.item?.title || "Unknown track"}
          </p>
          <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
            {playback.item?.creator || ""}
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <button onClick={previous} className="rounded-md p-1.5 transition hover:bg-white/5" style={{ color: "var(--text-secondary)" }} aria-label="Previous">⏮</button>
            <button onClick={toggle} className="rounded-md px-3 py-1.5 text-[12px] font-bold transition hover:opacity-80" style={{ backgroundColor: "rgba(155,77,255,0.15)", color: "var(--spark-primary)", border: "1px solid rgba(155,77,255,0.25)" }} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? "⏸" : "▶"}</button>
            <button onClick={next} className="rounded-md p-1.5 transition hover:bg-white/5" style={{ color: "var(--text-secondary)" }} aria-label="Next">⏭</button>
          </div>
        </div>
      )}

      {/* LiTTree Music (if playing) */}
      {!hasItem && hasLittTrack && littMusic && (
        <div className="mb-3 rounded-xl border p-3" style={{ borderColor: "rgba(0,255,200,0.15)", background: "rgba(0,255,200,0.04)" }}>
          <div className="flex items-center gap-2">
            <span className="rounded px-1.5 py-0.5 text-[9px] font-black" style={{ backgroundColor: "rgba(0,255,200,0.15)", color: "#00ffc8" }}>LiTTree</span>
            <p className="truncate text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{littTrack.title}</p>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <button onClick={() => littMusic.prev()} className="rounded-md p-1.5 transition hover:bg-white/5" style={{ color: "var(--text-secondary)" }} aria-label="Previous">⏮</button>
            <button onClick={() => littMusic.togglePlay()} className="rounded-md px-3 py-1.5 text-[12px] font-bold transition hover:opacity-80" style={{ backgroundColor: "rgba(0,255,200,0.15)", color: "#00ffc8", border: "1px solid rgba(0,255,200,0.25)" }} aria-label={littPlaying ? "Pause" : "Play"}>{littPlaying ? "⏸" : "▶"}</button>
            <button onClick={() => littMusic.next()} className="rounded-md p-1.5 transition hover:bg-white/5" style={{ color: "var(--text-secondary)" }} aria-label="Next">⏭</button>
          </div>
        </div>
      )}

      {/* Provider connection list */}
      {!hasItem && !hasLittTrack && (
        <div className="space-y-1.5">
          {DASHBOARD_PROVIDERS.map((p) => {
            const label = PROVIDER_LABELS[p.id];
            const color = PROVIDER_COLORS[p.id];
            const isActive = activeProvider === p.id;
            const isLitt = p.id === "litt";
            return (
              <button
                key={p.id}
                onClick={() => isLitt ? switchProvider("litt") : switchProvider(p.id)}
                className="flex w-full items-center justify-between rounded-lg border px-3 py-2 transition hover:opacity-80"
                style={{
                  borderColor: isActive ? `${color}40` : "var(--studio-border)",
                  background: isActive ? `${color}08` : "rgba(0,0,0,0.15)",
                }}
              >
                <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{label}</span>
                <span className="text-[10px] font-black" style={{ color: isLitt ? color : isActive ? color : "var(--text-muted)" }}>
                  {isLitt ? "✓ Ready" : "Connect"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Advanced / Paste Link (collapsible) */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[10px] font-bold transition hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          {showAdvanced ? "− Hide paste link" : "+ Paste link (advanced)"}
        </button>
        {showAdvanced && (
          <form onSubmit={handleSubmit} className="mt-2 flex gap-1.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste YouTube, Spotify, or audio URL…"
              className="min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-[12px] outline-none transition focus:border-[var(--spark-primary)]"
              style={{ backgroundColor: "var(--studio-surface)", borderColor: "var(--studio-border)", color: "var(--text-primary)" }}
              aria-label="Media URL input"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-bold transition hover:opacity-80"
              style={{ backgroundColor: "rgba(155,77,255,0.15)", color: "var(--spark-primary)", border: "1px solid rgba(155,77,255,0.25)" }}
            >
              Play
            </button>
          </form>
        )}
        {showAdvanced && error && (
          <p className="mt-1.5 text-[11px] font-bold" style={{ color: "var(--error)" }}>{error}</p>
        )}
      </div>
    </div>
  );
}
