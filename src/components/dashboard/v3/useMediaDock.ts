"use client";

/**
 * useMediaDock — coordination hook for the dashboard media dock.
 *
 * This is NOT a new media provider. It does NOT create a new audio
 * element, playback state, or queue store. It reads from the two
 * existing authoritative systems and presents a unified dock interface:
 *
 *   1. MediaHubProvider  — YouTube, Spotify, SoundCloud, Apple Music,
 *                          direct audio, LiTT R2 assets (via useMediaHub)
 *   2. MusicPlayerContext — LiTT-generated audio tracks (via useMusicPlayerOptional)
 *
 * The hook ensures only one source plays at a time: when LiTT audio
 * starts, MediaHub is paused, and vice-versa. It derives a unified
 * queue view from whichever source is currently active.
 */

import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useMediaHub } from "@/components/media/MediaHubProvider";
import { useMusicPlayerOptional, type PlayerTrack } from "@/context/MusicPlayerContext";
import type { MediaItem, MediaProviderId } from "@/components/media/media-types";
import type { DockQueueItem } from "./types";

// ── Types ─────────────────────────────────────────────────────────

export type DockSource = MediaProviderId | "litt-music" | "none";

export interface MediaDockActions {
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
  /** Play a LiTT-generated track (MusicPlayerContext). */
  playLittTrack: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  /** Add a LiTT-generated track to the LiTT queue. */
  addLittTrackToQueue: (track: PlayerTrack) => void;
  /** Load a URL into MediaHub (YouTube, Spotify, etc.). */
  loadUrl: (url: string) => boolean;
  /** Jump to a specific queue item. */
  jumpTo: (index: number) => void;
  /** Remove an item from the active queue. */
  removeFromQueue: (index: number) => void;
  /** Clear the active queue. */
  clearQueue: () => void;
}

export interface MediaDockValue {
  source: DockSource;
  littTrack: PlayerTrack | null;
  mediaItem: MediaItem | null;
  title: string;
  creator: string;
  artworkUrl: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  durationMs: number;
  positionMs: number;
  volume: number;
  error: string | null;
  queue: DockQueueItem[];
  /** Whether seek is supported by the active source. */
  canSeek: boolean;
}

export interface UseMediaDockResult {
  dock: MediaDockValue;
  actions: MediaDockActions;
}

// ── Hook ──────────────────────────────────────────────────────────

export function useMediaDock(): UseMediaDockResult {
  const hub = useMediaHub();
  const litt = useMusicPlayerOptional();

  // Track which source was last interacted with so we know which to
  // prioritise when both have an item loaded. Using state so it's
  // safe to read during render (useMemo).
  const [lastSource, setLastSource] = useState<DockSource>("none");

  // When LiTT music starts playing, pause MediaHub.
  // When MediaHub starts playing, pause LiTT music.
  const wasLittPlaying = useRef(false);
  const wasHubPlaying = useRef(false);

  useEffect(() => {
    const littPlaying = litt?.isPlaying ?? false;
    const hubPlaying = hub.playback.status === "playing";

    // LiTT just started playing → pause hub
    if (littPlaying && !wasLittPlaying.current) {
      if (hub.playback.status === "playing") {
        hub.pause();
      }
      setLastSource("litt-music");
    }
    wasLittPlaying.current = littPlaying;

    // Hub just started playing → pause LiTT
    if (hubPlaying && !wasHubPlaying.current) {
      if (litt?.isPlaying) {
        litt.togglePlay();
      }
      setLastSource(hub.activeProvider);
    }
    wasHubPlaying.current = hubPlaying;
  }, [litt?.isPlaying, hub.playback.status, hub.activeProvider, hub, litt]);

  // ── Determine active source ─────────────────────────────────────
  //
  // Priority:
  //   1. Whatever was last interacted with (lastSourceRef)
  //   2. If only one has an item, use that
  //   3. none

  const hubHasItem = !!hub.playback.item;
  const littHasItem = !!(litt?.current);

  const source: DockSource = useMemo(() => {
    const last = lastSource;
    if (last === "litt-music" && littHasItem) return "litt-music";
    if (last !== "none" && last !== "litt-music" && hubHasItem) return last;
    if (hubHasItem && !littHasItem) return hub.activeProvider;
    if (littHasItem && !hubHasItem) return "litt-music";
    if (hubHasItem && littHasItem) {
      // Both have items — prefer whichever is playing
      if (hub.playback.status === "playing") return hub.activeProvider;
      if (litt?.isPlaying) return "litt-music";
      return hub.activeProvider;
    }
    return "none";
  }, [
    lastSource,
    hubHasItem,
    littHasItem,
    hub.activeProvider,
    hub.playback.status,
    litt?.isPlaying,
  ]);

  // ── Derive dock state from the active source ────────────────────

  const isLittSource = source === "litt-music";

  const dock: MediaDockValue = useMemo(() => {
    if (isLittSource && litt) {
      const track = litt.current;
      return {
        source: "litt-music",
        littTrack: track,
        mediaItem: null,
        title: track?.title ?? "Nothing playing",
        creator: track?.version_label ?? "LiTT Audio",
        artworkUrl: null,
        isPlaying: litt.isPlaying,
        isLoading: litt.loadingUrl,
        durationMs: (litt.duration || 0) * 1000,
        positionMs: (litt.currentTime || 0) * 1000,
        volume: litt.muted ? 0 : litt.volume,
        error: null,
        queue: litt.queue.map((t, i) => ({
          id: t.id,
          title: t.title,
          source: "litt" as const,
          isActive: i === litt.currentIdx,
        })),
        canSeek: true,
      };
    }

    // MediaHub source
    const item = hub.playback.item;
    const providerLabel = hub.activeProvider;
    return {
      source: source === "none" ? "none" : (source as MediaProviderId),
      littTrack: null,
      mediaItem: item,
      title: item?.title ?? (item ? "Unknown track" : "Nothing playing"),
      creator: item?.creator ?? (item ? providerLabel : ""),
      artworkUrl: item?.artworkUrl ?? null,
      isPlaying: hub.playback.status === "playing",
      isLoading: hub.playback.status === "loading" || hub.playback.status === "buffering",
      durationMs: hub.playback.durationMs || 0,
      positionMs: hub.playback.positionMs || 0,
      volume: hub.playback.muted ? 0 : hub.playback.volume,
      error: hub.playback.error,
      queue: hub.queue.map((qItem, i) => ({
        id: qItem.id,
        title: qItem.title ?? qItem.sourceUrl,
        source: qItem.provider,
        artworkUrl: qItem.artworkUrl,
        isActive: i === hub.currentIndex,
      })),
      canSeek: hub.playback.durationMs > 0,
    };
  }, [
    isLittSource,
    litt,
    hub.playback,
    hub.queue,
    hub.currentIndex,
    hub.activeProvider,
    source,
  ]);

  // ── Actions ─────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    if (isLittSource) {
      litt?.togglePlay();
    } else {
      hub.toggle();
    }
  }, [isLittSource, litt, hub]);

  const play = useCallback(() => {
    if (isLittSource) {
      // MusicPlayerContext doesn't have a bare play() — togglePlay handles it
      const audio = litt?.current;
      if (audio && !litt?.isPlaying) litt?.togglePlay();
    } else {
      hub.play();
    }
  }, [isLittSource, litt, hub]);

  const pause = useCallback(() => {
    if (isLittSource) {
      if (litt?.isPlaying) litt?.togglePlay();
    } else {
      hub.pause();
    }
  }, [isLittSource, litt, hub]);

  const next = useCallback(() => {
    if (isLittSource) {
      litt?.next();
    } else {
      hub.next();
    }
  }, [isLittSource, litt, hub]);

  const previous = useCallback(() => {
    if (isLittSource) {
      litt?.prev();
    } else {
      hub.previous();
    }
  }, [isLittSource, litt, hub]);

  const seek = useCallback(
    (milliseconds: number) => {
      if (isLittSource) {
        // MusicPlayerContext.seek takes seconds
        litt?.seek(milliseconds / 1000);
      } else {
        hub.seek(milliseconds);
      }
    },
    [isLittSource, litt, hub],
  );

  const setVolume = useCallback(
    (volume: number) => {
      const v = Math.max(0, Math.min(100, volume));
      if (isLittSource) {
        litt?.setVolume(v);
      } else {
        hub.setVolume(v);
      }
    },
    [isLittSource, litt, hub],
  );

  const playLittTrack = useCallback(
    (track: PlayerTrack, queue?: PlayerTrack[]) => {
      setLastSource("litt-music");
      // Pause hub if playing
      if (hub.playback.status === "playing") {
        hub.pause();
      }
      litt?.playTrack(track, queue);
    },
    [hub, litt],
  );

  const addLittTrackToQueue = useCallback(
    (track: PlayerTrack) => {
      // MusicPlayerContext doesn't have an explicit addToQueue,
      // but we can use setQueue to append. If there's no current queue,
      // start one.
      if (!litt) return;
      const existingQueue = litt.queue;
      if (existingQueue.some((t) => t.id === track.id)) return;
      litt.setQueue([...existingQueue, track]);
    },
    [litt],
  );

  const loadUrl = useCallback(
    (url: string): boolean => {
      setLastSource("none"); // hub.loadUrl will set the provider
      // Pause LiTT if playing
      if (litt?.isPlaying) {
        litt.togglePlay();
      }
      return hub.loadUrl(url);
    },
    [hub, litt],
  );

  const jumpTo = useCallback(
    (index: number) => {
      if (isLittSource) {
        // MusicPlayerContext doesn't expose jumpTo directly.
        // We can use playTrack with the existing queue.
        if (!litt) return;
        const track = litt.queue[index];
        if (track) {
          litt.playTrack(track, litt.queue);
          // Adjust currentIdx — playTrack with same queue finds the index
        }
      } else {
        hub.jumpTo(index);
      }
    },
    [isLittSource, litt, hub],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      if (isLittSource) {
        litt?.removeFromQueue(index);
      } else {
        hub.removeFromQueue(index);
      }
    },
    [isLittSource, litt, hub],
  );

  const clearQueue = useCallback(() => {
    if (isLittSource) {
      litt?.setQueue([]);
    } else {
      hub.clearQueue();
    }
  }, [isLittSource, litt, hub]);

  const actions: MediaDockActions = useMemo(
    () => ({
      toggle,
      play,
      pause,
      next,
      previous,
      seek,
      setVolume,
      playLittTrack,
      addLittTrackToQueue,
      loadUrl,
      jumpTo,
      removeFromQueue,
      clearQueue,
    }),
    [
      toggle,
      play,
      pause,
      next,
      previous,
      seek,
      setVolume,
      playLittTrack,
      addLittTrackToQueue,
      loadUrl,
      jumpTo,
      removeFromQueue,
      clearQueue,
    ],
  );

  return { dock, actions };
}
