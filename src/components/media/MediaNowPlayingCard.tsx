"use client";

/**
 * MediaNowPlayingCard — compact Dashboard card showing the current
 * media state. Uses the global Media Hub — does NOT mount its own
 * iframe. Just displays state and basic controls.
 *
 * Includes a URL input so users can paste YouTube/Spotify links
 * directly from the dashboard without going to Studio.
 */

import { useState, useCallback } from "react";
import { useMediaHub } from "./MediaHubProvider";
import { parseMediaUrl } from "./parse-media-url";

export function MediaNowPlayingCard() {
  const {
    activeProvider,
    playback,
    toggle,
    next,
    previous,
    showCollapsed,
    showExpanded,
    dockMode,
    loadUrl,
  } = useMediaHub();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isPlaying = playback.status === "playing";
  const hasItem = !!playback.item;

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
          Now Playing
        </h3>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-black"
          style={{
            backgroundColor: activeProvider === "youtube" ? "rgba(255,0,0,0.15)" : activeProvider === "spotify" ? "rgba(30,215,96,0.15)" : "rgba(255,255,255,0.05)",
            color: activeProvider === "youtube" ? "#ff6b6b" : activeProvider === "spotify" ? "#1ed760" : "var(--text-muted)",
          }}
        >
          {activeProvider === "youtube" ? "YT" : activeProvider === "spotify" ? "SP" : "—"}
        </span>
      </div>

      {hasItem ? (
        <>
          {/* Artwork */}
          {playback.item?.artworkUrl && (
            <img
              src={playback.item.artworkUrl}
              alt=""
              className="mb-3 w-full rounded-lg"
              style={{ aspectRatio: "16 / 9", objectFit: "cover" }}
            />
          )}

          {/* Title + creator */}
          <p className="truncate text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>
            {playback.item?.title || "Unknown track"}
          </p>
          <p className="mb-3 truncate text-[12px]" style={{ color: "var(--text-muted)" }}>
            {playback.item?.creator || ""}
          </p>

          {/* Controls */}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={previous}
              className="rounded-md p-2 transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Previous track"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={toggle}
              className="rounded-md px-4 py-2 text-[13px] font-bold transition hover:opacity-80"
              style={{
                backgroundColor: "rgba(155,77,255,0.15)",
                color: "var(--spark-primary)",
                border: "1px solid rgba(155,77,255,0.25)",
              }}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-md p-2 transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Next track"
            >
              ⏭
            </button>
          </div>

          {/* Open in Studio */}
          <button
            type="button"
            onClick={showExpanded}
            className="mt-3 w-full rounded-md border py-2 text-[12px] font-bold transition hover:bg-white/5"
            style={{
              borderColor: "var(--studio-border)",
              color: "var(--text-secondary)",
            }}
          >
            Expand in Studio →
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-3 py-2">
          {/* URL input — play directly from dashboard */}
          <form onSubmit={handleSubmit} className="flex gap-1.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste YouTube or Spotify link…"
              className="min-w-0 flex-1 rounded-md border px-3 py-2 text-[13px] outline-none transition focus:border-[var(--spark-primary)]"
              style={{
                backgroundColor: "var(--studio-surface)",
                borderColor: "var(--studio-border)",
                color: "var(--text-primary)",
              }}
              aria-label="Media URL input"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md px-3 py-2 text-[13px] font-bold transition hover:opacity-80"
              style={{
                backgroundColor: "rgba(155,77,255,0.15)",
                color: "var(--spark-primary)",
                border: "1px solid rgba(155,77,255,0.25)",
              }}
            >
              Play
            </button>
          </form>
          {error && (
            <p className="text-[12px] font-bold" style={{ color: "var(--error)" }}>
              {error}
            </p>
          )}
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Paste a YouTube or Spotify link to start playing.
          </p>
        </div>
      )}
    </div>
  );
}
