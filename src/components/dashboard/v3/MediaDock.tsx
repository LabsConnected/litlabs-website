"use client";

/**
 * MediaDock — universal persistent media dock (footer bar).
 *
 * Left: artwork + title / source
 * Center: shuffle, prev, play/pause, next, repeat + seek bar
 * Right: favorite, queue, volume, Focus
 *
 * Reads from the unified useMediaDock hook which coordinates
 * LiTT audio (MusicPlayerContext) and YouTube (MediaHubProvider).
 * Never allows two sources to play simultaneously.
 *
 * Mobile: compact [art] title ▷ — tap opens Focus Mode.
 */

import { useState, useCallback, useRef } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Heart,
  ListMusic,
  Volume2,
  VolumeX,
  Focus,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { MediaDockValue, MediaDockActions } from "./useMediaDock";
import { formatTime } from "./media-helpers";
import { isFavorite, toggleFavorite } from "./types";

interface MediaDockProps {
  dock: MediaDockValue;
  actions: MediaDockActions;
  onOpenQueue: () => void;
  onOpenFocusMode: () => void;
}

export function MediaDock({ dock, actions, onOpenQueue, onOpenFocusMode }: MediaDockProps) {
  const seekRef = useRef<HTMLDivElement>(null);
  const [fav, setFav] = useState(false);

  // Update favorite state when track changes
  const currentId = dock.source === "litt" ? dock.littTrack?.id : dock.mediaItem?.id;
  if (currentId) {
    const isFav = isFavorite(currentId);
    if (isFav !== fav) setFav(isFav);
  }

  const handleSeek = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const bar = seekRef.current;
      if (!bar || dock.durationMs === 0) return;
      const rect = bar.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      actions.seek(frac * dock.durationMs);
    },
    [dock.durationMs, actions],
  );

  const handleFavorite = useCallback(() => {
    if (!currentId) return;
    const isFav = toggleFavorite(currentId);
    setFav(isFav);
  }, [currentId]);

  const handleVolume = useCallback(
    (e: React.MouseEvent) => {
      const bar = e.currentTarget;
      const rect = bar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      actions.setVolume(Math.round(frac * 100));
    },
    [actions],
  );

  // Empty state
  if (dock.source === "none" && dock.queue.length === 0) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-center border-t px-4 backdrop-blur-xl md:h-20 md:px-6"
        style={{
          background: "rgba(10,10,10,0.8)",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        <p className="text-sm" style={{ color: "#71717a" }}>
          Nothing playing — Choose media or paste a YouTube URL
        </p>
        <button
          onClick={onOpenQueue}
          className="ml-3 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            borderColor: "rgba(167,139,250,0.3)",
            color: "#a78bfa",
          }}
        >
          Open Queue
        </button>
      </div>
    );
  }

  const progress = dock.durationMs > 0 ? (dock.positionMs / dock.durationMs) * 100 : 0;
  const volumePct = dock.volume;

  return (
    <>
      {/* Desktop dock */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 hidden h-20 items-center justify-between border-t px-6 backdrop-blur-xl md:flex"
        style={{
          background: "rgba(10,10,10,0.85)",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        {/* Left: Artwork & Info */}
        <div className="flex w-1/4 min-w-[200px] items-center gap-4">
          <button
            onClick={onOpenFocusMode}
            className="relative h-12 w-12 shrink-0 overflow-hidden rounded border transition-opacity hover:opacity-80"
            style={{
              borderColor: "rgba(255,255,255,0.06)",
              background: "rgba(18,18,21,0.8)",
            }}
            aria-label="Open Focus Mode"
          >
            {dock.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dock.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                {dock.source === "litt" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                ) : dock.source === "youtube" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#ff0000">
                    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" />
                  </svg>
                ) : null}
              </div>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" style={{ color: "#fafafa" }}>
              {dock.title}
            </div>
            <div className="truncate font-mono text-xs" style={{ color: "#71717a" }}>
              {dock.creator}
            </div>
          </div>
        </div>

        {/* Center: Playback Controls */}
        <div className="flex max-w-[500px] flex-1 flex-col items-center">
          <div className="mb-2 flex items-center gap-4" style={{ color: "#a1a1aa" }}>
            <button className="transition-colors hover:text-white" aria-label="Shuffle">
              <Shuffle size={16} />
            </button>
            <button
              onClick={actions.previous}
              className="transition-colors hover:text-white"
              aria-label="Previous"
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              onClick={actions.toggle}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105"
              style={{ background: "#fafafa", color: "#0a0a0a" }}
              aria-label={dock.isPlaying ? "Pause" : "Play"}
            >
              {dock.isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : dock.isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" />
              )}
            </button>
            <button
              onClick={actions.next}
              className="transition-colors hover:text-white"
              aria-label="Next"
            >
              <SkipForward size={20} fill="currentColor" />
            </button>
            <button className="transition-colors hover:text-white" aria-label="Repeat">
              <Repeat size={16} />
            </button>
          </div>

          {/* Seek bar */}
          <div className="flex w-full items-center gap-3 font-mono text-[10px]" style={{ color: "#71717a" }}>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatTime(dock.positionMs)}</span>
            <div
              ref={seekRef}
              className="group relative h-1 flex-1 cursor-pointer rounded-full"
              style={{ background: "rgba(30,30,34,0.8)" }}
              onClick={handleSeek}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-colors"
                style={{
                  width: `${progress}%`,
                  background: "var(--dash-accent, #fafafa)",
                }}
              />
            </div>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatTime(dock.durationMs)}</span>
          </div>

          {/* Error indicator */}
          {dock.error && (
            <div className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: "#ef4444" }}>
              <AlertCircle size={12} />
              {dock.error}
            </div>
          )}
        </div>

        {/* Right: Volume & Actions */}
        <div className="flex w-1/4 min-w-[200px] items-center justify-end gap-4" style={{ color: "#a1a1aa" }}>
          <button
            onClick={handleFavorite}
            className="transition-colors hover:text-white"
            aria-label="Favorite"
          >
            <Heart
              size={18}
              style={{ color: fav ? "#ef4444" : undefined, fill: fav ? "#ef4444" : "none" }}
            />
          </button>
          <button
            onClick={onOpenQueue}
            className="transition-colors hover:text-white"
            aria-label="Queue"
          >
            <ListMusic size={18} />
          </button>
          <div className="group flex items-center gap-2" style={{ width: 96 }}>
            <button
              onClick={() => actions.setVolume(volumePct > 0 ? 0 : 70)}
              className="transition-colors hover:text-white"
              aria-label="Mute"
            >
              {volumePct === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <div
              className="relative h-1 flex-1 cursor-pointer rounded-full"
              style={{ background: "rgba(30,30,34,0.8)" }}
              onClick={handleVolume}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{ width: `${volumePct}%`, background: "#a1a1aa" }}
              />
            </div>
          </div>
          <div className="mx-1 h-6 w-px" style={{ background: "rgba(255,255,255,0.06)" }} />
          <button
            onClick={onOpenFocusMode}
            className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              borderColor: "rgba(255,255,255,0.06)",
              background: "rgba(18,18,21,0.6)",
              color: "#fafafa",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(167,139,250,0.3)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}
          >
            <Focus size={16} style={{ color: "#a78bfa" }} />
            Focus
          </button>
        </div>
      </div>

      {/* Mobile mini player */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-between border-t px-3 backdrop-blur-xl md:hidden"
        style={{
          background: "rgba(10,10,10,0.9)",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        <button
          onClick={onOpenFocusMode}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <div
            className="h-9 w-9 shrink-0 overflow-hidden rounded"
            style={{ background: "rgba(18,18,21,0.8)" }}
          >
            {dock.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dock.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium" style={{ color: "#fafafa" }}>
              {dock.title}
            </div>
            <div className="truncate text-[10px]" style={{ color: "#71717a" }}>
              {dock.creator}
            </div>
          </div>
        </button>
        <button
          onClick={actions.toggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#fafafa", color: "#0a0a0a" }}
          aria-label={dock.isPlaying ? "Pause" : "Play"}
        >
          {dock.isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : dock.isPlaying ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
        </button>
      </div>
    </>
  );
}
