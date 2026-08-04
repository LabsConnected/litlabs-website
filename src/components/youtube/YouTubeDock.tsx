"use client";

/**
 * YouTubeDock — the premium docked player card for the Dashboard.
 *
 * Shows:
 *   - 16:9 YouTube player viewport
 *   - Track/video title + channel
 *   - Transport controls (play/pause, prev, next, stop)
 *   - Volume slider + mute
 *   - Progress bar
 *   - Paste URL input (video or playlist)
 *   - Queue drawer
 *   - Minimize / expand buttons
 *
 * Uses the official YouTube IFrame Player — no hidden fake players.
 */

import { useState, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Plus,
  Minimize2,
  Maximize2,
  X,
  ListMusic,
  Link2,
  AlertCircle,
  Music,
  Search,
} from "lucide-react";
import { useYouTubePlayer } from "@/context/YouTubePlayerContext";
import { YouTubePlayerHost } from "./YouTubePlayerHost";
import { YouTubeSearchPanel } from "./YouTubeSearchPanel";
import { parseYouTubeUrl } from "@/lib/youtube/url-parser";

function formatTime(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function YouTubeDock() {
  const {
    state,
    currentVideo,
    currentTitle,
    currentChannel,
    currentTime,
    duration,
    volume,
    muted,
    queue,
    currentIndex,
    error,
    isPlaying,
    isReady,
    play,
    pause,
    stop,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    loadVideo,
    addToQueue,
    loadPlaylist,
    removeFromQueue,
    clearQueue,
    jumpTo,
    showMini,
    showExpanded,
    hide,
  } = useYouTubePlayer();

  const [urlInput, setUrlInput] = useState("");
  const [showQueue, setShowQueue] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleLoadUrl = useCallback(() => {
    if (!urlInput.trim()) return;
    setUrlError(null);
    const { video, playlist } = parseYouTubeUrl(urlInput);

    if (playlist) {
      loadPlaylist(urlInput);
      setUrlInput("");
    } else if (video) {
      loadVideo(urlInput);
      setUrlInput("");
    } else {
      setUrlError("Could not parse a YouTube video or playlist URL.");
    }
  }, [urlInput, loadVideo, loadPlaylist]);

  const handleAddToQueue = useCallback(() => {
    if (!urlInput.trim()) return;
    setUrlError(null);
    const { video } = parseYouTubeUrl(urlInput);
    if (video) {
      addToQueue(urlInput);
      setUrlInput("");
    } else {
      setUrlError("Could not parse a YouTube video URL.");
    }
  }, [urlInput, addToQueue]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="rounded-2xl border border-purple-500/20 bg-black/60 p-4 backdrop-blur-xl"
      style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 24px rgba(168,85,247,0.08)" }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={14} className="text-purple-400" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">
            LiTT Media Player
          </span>
          <span className="text-[9px] text-white/30">Powered by YouTube</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setShowSearch(!showSearch); if (!showSearch) setShowQueue(false); }}
            className={`grid h-7 w-7 place-items-center rounded-lg transition hover:bg-white/10 hover:text-white ${showSearch ? "bg-purple-500/15 text-purple-300" : "text-white/50"}`}
            aria-label="Search YouTube Music"
            title="Search"
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            onClick={() => setShowQueue(!showQueue)}
            className={`grid h-7 w-7 place-items-center rounded-lg transition hover:bg-white/10 hover:text-white ${showQueue ? "bg-purple-500/15 text-purple-300" : "text-white/50"}`}
            aria-label="Toggle queue"
            title="Queue"
          >
            <ListMusic size={14} />
          </button>
          <button
            type="button"
            onClick={showMini}
            className="grid h-7 w-7 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Minimize player"
            title="Minimize"
          >
            <Minimize2 size={14} />
          </button>
          <button
            type="button"
            onClick={showExpanded}
            className="grid h-7 w-7 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Expand player"
            title="Expand"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            onClick={hide}
            className="grid h-7 w-7 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Close player"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Player viewport — 16:9, minimum 200x200 */}
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
        <YouTubePlayerHost />
        {/* Loading overlay */}
        {(state === "loading_api" || state === "creating_player") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-400/30 border-t-purple-400" />
          </div>
        )}
        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90 p-4 text-center">
            <AlertCircle size={24} className="text-red-400" />
            <p className="text-xs text-red-300">{error.message}</p>
            <button
              type="button"
              onClick={() => {
                if (urlInput) handleLoadUrl();
              }}
              className="mt-1 rounded-lg border border-white/20 px-3 py-1 text-[10px] font-bold text-white/70 hover:bg-white/10"
            >
              Try again
            </button>
          </div>
        )}
        {/* Idle overlay — no video loaded */}
        {!error && state === "idle" && !currentVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-purple-950/40 to-black/80 p-4 text-center">
            <Music size={32} className="text-purple-400/40" />
            <p className="text-xs text-white/40">Paste a YouTube URL below to start playing</p>
          </div>
        )}
      </div>

      {/* Now playing metadata */}
      {(currentTitle || currentVideo) && (
        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">
              {currentTitle || currentVideo?.title || "Unknown track"}
            </p>
            <p className="truncate text-[11px] text-white/40">
              {currentChannel || currentVideo?.channel || "YouTube"}
            </p>
          </div>
          {/* Playing indicator */}
          {isPlaying && (
            <div className="flex items-end gap-0.5">
              <span className="h-2 w-0.5 animate-pulse rounded-full bg-purple-400" style={{ animationDelay: "0ms" }} />
              <span className="h-3 w-0.5 animate-pulse rounded-full bg-purple-400" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-0.5 animate-pulse rounded-full bg-purple-400" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {isReady && duration > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/40">{formatTime(currentTime)}</span>
          <div
            className="relative h-1 flex-1 cursor-pointer rounded-full bg-white/10"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              seek(pct * duration);
            }}
          >
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-white/40">{formatTime(duration)}</span>
        </div>
      )}

      {/* Transport controls */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={previous}
            disabled={queue.length < 2}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            aria-label="Previous track"
          >
            <SkipBack size={15} />
          </button>
          <button
            type="button"
            onClick={isPlaying ? pause : play}
            disabled={!isReady && !currentVideo}
            className="grid h-9 w-9 place-items-center rounded-lg bg-purple-500/20 text-purple-300 transition hover:bg-purple-500/30 disabled:opacity-30"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={queue.length < 2}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            aria-label="Next track"
          >
            <SkipForward size={15} />
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!isReady}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            aria-label="Stop"
          >
            <Square size={14} />
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/10 accent-purple-500"
            aria-label="Volume"
          />
        </div>
      </div>

      {/* URL input */}
      <div className="mt-3 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Link2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleLoadUrl(); }}
            placeholder="Paste YouTube video or playlist URL…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-xs text-white outline-none placeholder:text-white/25 focus:border-purple-500/40"
          />
        </div>
        <button
          type="button"
          onClick={handleLoadUrl}
          disabled={!urlInput.trim()}
          className="rounded-lg bg-purple-500/20 px-3 py-2 text-xs font-bold text-purple-300 transition hover:bg-purple-500/30 disabled:opacity-30"
        >
          Play
        </button>
        <button
          type="button"
          onClick={handleAddToQueue}
          disabled={!urlInput.trim()}
          className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          aria-label="Add to queue"
          title="Add to queue"
        >
          <Plus size={14} />
        </button>
      </div>
      {urlError && (
        <p className="mt-1 text-[10px] text-red-400">{urlError}</p>
      )}

      {/* Search panel */}
      {showSearch && (
        <div className="mt-3 rounded-xl border border-purple-500/15 bg-black/40 p-3">
          <YouTubeSearchPanel onClose={() => setShowSearch(false)} />
        </div>
      )}

      {/* Queue drawer */}
      {showQueue && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-white/40">
              Queue ({queue.length})
            </span>
            {queue.length > 0 && (
              <button
                type="button"
                onClick={clearQueue}
                className="text-[10px] font-bold text-red-400/70 hover:text-red-400"
              >
                Clear
              </button>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-white/30">
              Queue is empty. Paste a URL above to add tracks.
            </p>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {queue.map((item, i) => (
                <div
                  key={`${item.videoId}-${i}`}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition ${
                    i === currentIndex
                      ? "bg-purple-500/15 text-purple-200"
                      : "text-white/60 hover:bg-white/5"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => jumpTo(i)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-bold">
                      {item.title || `Video ${item.videoId}`}
                    </span>
                    {item.channel && (
                      <span className="block truncate text-[10px] text-white/30">
                        {item.channel}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(i)}
                    className="shrink-0 text-white/30 hover:text-red-400"
                    aria-label="Remove from queue"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
