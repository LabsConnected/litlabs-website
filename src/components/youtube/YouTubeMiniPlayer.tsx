"use client";

/**
 * YouTubeMiniPlayer — floating bottom-right mini player for
 * authenticated pages other than Dashboard.
 *
 * Shows:
 *   - Compact 16:9 YouTube player (minimum 200x200 per YouTube guidelines)
 *   - Title
 *   - Play/pause, prev/next
 *   - Expand (to docked on Dashboard) and close
 *
 * The player host is rendered ONCE here and the controller keeps
 * the same YT.Player instance. When the user navigates to Dashboard,
 * the dock takes over rendering.
 *
 * Note: The actual YT.Player instance lives in the controller.
 * The mini-player renders a player host div that the controller
 * attaches to. When switching between mini and dock, the controller
 * destroys and recreates the player — this is expected because
 * the IFrame API does not support moving the iframe between parents.
 */

import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  X,
  Music,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { useYouTubePlayer } from "@/context/YouTubePlayerContext";
import { YouTubePlayerHost } from "./YouTubePlayerHost";

export function YouTubeMiniPlayer() {
  const {
    state,
    currentVideo,
    currentTitle,
    currentChannel,
    error,
    isPlaying,
    isReady,
    play,
    pause,
    next,
    previous,
    hide,
  } = useYouTubePlayer();

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[280px] rounded-2xl border border-purple-500/20 bg-black/80 p-3 backdrop-blur-xl sm:w-[320px]"
      style={{
        boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 24px rgba(168,85,247,0.1)",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Music size={11} className="text-purple-400" />
          <span className="text-[9px] font-black uppercase tracking-wider text-purple-300">
            LiTT Media
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Link
            href="/dashboard"
            className="grid h-6 w-6 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Expand on Dashboard"
            title="Open on Dashboard"
          >
            <Maximize2 size={12} />
          </Link>
          <button
            type="button"
            onClick={hide}
            className="grid h-6 w-6 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Close player"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Player viewport — 16:9 */}
      <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black">
        <YouTubePlayerHost />
        {(state === "loading_api" || state === "creating_player") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-400/30 border-t-purple-400" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/90 p-2 text-center">
            <AlertCircle size={18} className="text-red-400" />
            <p className="text-[10px] text-red-300">{error.message}</p>
          </div>
        )}
        {!error && state === "idle" && !currentVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-purple-950/40 to-black/80 p-2 text-center">
            <Music size={20} className="text-purple-400/40" />
            <p className="text-[10px] text-white/40">Open Dashboard to add a video</p>
          </div>
        )}
      </div>

      {/* Title */}
      {(currentTitle || currentVideo) && (
        <div className="mt-2">
          <p className="truncate text-xs font-bold text-white">
            {currentTitle || currentVideo?.title || "Unknown track"}
          </p>
          <p className="truncate text-[10px] text-white/40">
            {currentChannel || currentVideo?.channel || "YouTube"}
          </p>
        </div>
      )}

      {/* Transport */}
      <div className="mt-2 flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={previous}
          className="grid h-7 w-7 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Previous"
        >
          <SkipBack size={13} />
        </button>
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          disabled={!isReady && !currentVideo}
          className="grid h-8 w-8 place-items-center rounded-lg bg-purple-500/20 text-purple-300 transition hover:bg-purple-500/30 disabled:opacity-30"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
        </button>
        <button
          type="button"
          onClick={next}
          className="grid h-7 w-7 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Next"
        >
          <SkipForward size={13} />
        </button>
      </div>
    </div>
  );
}
