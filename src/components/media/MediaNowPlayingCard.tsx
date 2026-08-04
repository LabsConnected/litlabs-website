"use client";

/**
 * MediaNowPlayingCard — compact Dashboard card showing the current
 * media state. Uses the global Media Hub — does NOT mount its own
 * iframe. Just displays state and basic controls.
 */

import { useMediaHub } from "./MediaHubProvider";

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
  } = useMediaHub();

  const isPlaying = playback.status === "playing";
  const hasItem = !!playback.item;

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: "var(--studio-border)",
        backgroundColor: "var(--studio-card)",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-black" style={{ color: "var(--text-primary)" }}>
          Now Playing
        </h3>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-black"
          style={{
            backgroundColor: activeProvider === "youtube" ? "rgba(255,0,0,0.15)" : "rgba(30,215,96,0.15)",
            color: activeProvider === "youtube" ? "#ff6b6b" : "#1ed760",
          }}
        >
          {activeProvider === "youtube" ? "YT" : "SP"}
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
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            No media playing
          </p>
          <button
            type="button"
            onClick={showCollapsed}
            className="rounded-md border px-4 py-2 text-[12px] font-bold transition hover:bg-white/5"
            style={{
              borderColor: "var(--studio-border)",
              color: "var(--text-secondary)",
            }}
          >
            Open Media in Studio →
          </button>
        </div>
      )}
    </div>
  );
}
