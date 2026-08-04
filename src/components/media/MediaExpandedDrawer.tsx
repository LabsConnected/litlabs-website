"use client";

/**
 * MediaExpandedDrawer — full media player panel shown when the dock
 * is expanded. Contains:
 *   - YouTube/Spotify provider tabs
 *   - Universal URL input
 *   - Player viewport (YouTube or Spotify host)
 *   - Track metadata + progress
 *   - Transport controls (play/pause, prev/next, volume)
 *   - Queue
 *   - Minimize and close
 */

import { useMediaHub } from "./MediaHubProvider";
import { MediaProviderTabs } from "./MediaProviderTabs";
import { MediaUrlInput } from "./MediaUrlInput";
import { MediaQueue } from "./MediaQueue";
import { YouTubeMediaHost } from "./providers/YouTubeMediaHost";
import { SpotifyMediaHost } from "./providers/SpotifyMediaHost";
import { SoundCloudMediaHost } from "./providers/SoundCloudMediaHost";
import { AppleMusicMediaHost } from "./providers/AppleMusicMediaHost";
import { DirectAudioMediaHost } from "./providers/DirectAudioMediaHost";
import { LittAssetMediaHost } from "./providers/LittAssetMediaHost";

function formatTime(ms: number): string {
  if (!ms || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MediaExpandedDrawer() {
  const {
    activeProvider,
    playback,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    showCollapsed,
    hide,
  } = useMediaHub();

  const isPlaying = playback.status === "playing";
  const hasItem = !!playback.item;
  const progress = playback.durationMs > 0
    ? (playback.positionMs / playback.durationMs) * 100
    : 0;

  return (
    <div
      className="flex shrink-0 flex-col border-t"
      style={{
        backgroundColor: "var(--studio-surface)",
        borderColor: "var(--studio-border)",
        height: 380,
      }}
      data-testid="media-expanded-drawer"
    >
      {/* Header: tabs + actions */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-3"
        style={{
          height: 40,
          borderColor: "var(--studio-border)",
        }}
      >
        <MediaProviderTabs />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={showCollapsed}
            className="rounded p-1.5 transition hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
            aria-label="Minimize media player"
            title="Minimize"
          >
            ⤓
          </button>
          <button
            type="button"
            onClick={hide}
            className="rounded p-1.5 transition hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close media player"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body: player viewport + controls + queue */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {/* URL input */}
        <MediaUrlInput />

        {/* Player viewport — minimum 200x200, prefer 480x270 */}
        <div
          className="relative w-full overflow-hidden rounded-lg border"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "#000",
            minHeight: 200,
            aspectRatio: "16 / 9",
          }}
        >
          {playback.status === "idle" && !hasItem ? (
            <div
              className="flex h-full items-center justify-center text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              Paste a link above to start playing
            </div>
          ) : playback.status === "error" ? (
            <div
              className="flex h-full items-center justify-center p-4 text-center text-[13px]"
              style={{ color: "var(--error)" }}
            >
              {playback.error || "Playback error"}
            </div>
          ) : (
            <>
              {/* Render both hosts but only show the active one.
                  This keeps both iframes alive across switches. */}
              <div
                style={{
                  display: activeProvider === "youtube" ? "block" : "none",
                  width: "100%",
                  height: "100%",
                }}
              >
                <YouTubeMediaHost minHeight={200} />
              </div>
              <div
                style={{
                  display: activeProvider === "spotify" ? "block" : "none",
                  width: "100%",
                  height: "100%",
                }}
              >
                <SpotifyMediaHost minHeight={200} />
              </div>
              <div
                style={{
                  display: activeProvider === "soundcloud" ? "block" : "none",
                  width: "100%",
                  height: "100%",
                }}
              >
                <SoundCloudMediaHost minHeight={166} />
              </div>
              <div
                style={{
                  display: activeProvider === "apple-music" ? "block" : "none",
                  width: "100%",
                  height: "100%",
                }}
              >
                <AppleMusicMediaHost minHeight={100} />
              </div>
              {/* Direct audio and LiTT assets use hidden audio elements — always mounted */}
              <DirectAudioMediaHost />
              <LittAssetMediaHost />
            </>
          )}
        </div>

        {/* Track metadata + progress */}
        {hasItem && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px] font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {playback.item?.title || "Unknown track"}
                </p>
                <p
                  className="truncate text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {playback.item?.creator || ""}
                </p>
              </div>
              <span
                className="shrink-0 text-[11px] font-bold"
                style={{ color: "var(--text-muted)" }}
              >
                {formatTime(playback.positionMs)} / {formatTime(playback.durationMs)}
              </span>
            </div>

            {/* Progress bar */}
            <div
              className="relative h-1.5 cursor-pointer rounded-full"
              style={{ backgroundColor: "var(--studio-border)" }}
              onClick={(e) => {
                if (playback.durationMs <= 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                seek(pct * playback.durationMs);
              }}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={playback.durationMs}
              aria-valuenow={playback.positionMs}
              tabIndex={0}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, var(--spark-primary), var(--violet-accent))",
                }}
              />
            </div>
          </div>
        )}

        {/* Transport controls */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={previous}
            disabled={!hasItem}
            className="rounded-md p-2 transition hover:bg-white/5 disabled:opacity-30"
            style={{ color: "var(--text-secondary)" }}
            aria-label="Previous track"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={!hasItem}
            className="rounded-md px-4 py-2 text-[14px] font-bold transition hover:opacity-80 disabled:opacity-30"
            style={{
              backgroundColor: "rgba(155,77,255,0.15)",
              color: "var(--spark-primary)",
              border: "1px solid rgba(155,77,255,0.25)",
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!hasItem}
            className="rounded-md p-2 transition hover:bg-white/5 disabled:opacity-30"
            style={{ color: "var(--text-secondary)" }}
            aria-label="Next track"
          >
            ⏭
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Vol</span>
          <input
            type="range"
            min={0}
            max={100}
            value={playback.muted ? 0 : playback.volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="flex-1"
            aria-label="Volume"
          />
          <span className="w-8 text-right text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
            {playback.muted ? "0" : playback.volume}%
          </span>
        </div>

        {/* Queue */}
        <MediaQueue />
      </div>
    </div>
  );
}
