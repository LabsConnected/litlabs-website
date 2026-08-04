"use client";

/**
 * MediaHubProvider — the ONE global media context.
 *
 * Mounted in the root authenticated layout so playback persists
 * across all routes (Dashboard, Studio Chat, Create, Preview, Code,
 * Assets, Agents). Replaces YouTubePlayerContext as the public
 * application interface for all media.
 *
 * Manages:
 *   - YouTube and Spotify adapters
 *   - Mixed-provider queue
 *   - Active provider switching (never simultaneous playback)
 *   - Playback state, volume, dock mode
 *   - localStorage persistence
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  MediaAdapter,
  MediaDockMode,
  MediaItem,
  MediaPlaybackState,
  MediaPersistedState,
  MediaProviderId,
} from "./media-types";
import { parseMediaUrl } from "./parse-media-url";
import { YouTubeMediaAdapter } from "./providers/YouTubeMediaAdapter";
import { SpotifyMediaAdapter } from "./providers/SpotifyMediaAdapter";
import { SoundCloudMediaAdapter } from "./providers/SoundCloudMediaAdapter";
import { AppleMusicMediaAdapter } from "./providers/AppleMusicMediaAdapter";
import { DirectAudioAdapter } from "./providers/DirectAudioAdapter";
import { LittAssetAdapter } from "./providers/LittAssetAdapter";

const STORAGE_KEY = "litt-media-hub";
const DEFAULT_VOLUME = 70;

// ── Context value type ───────────────────────────────────────────

export interface MediaHubContextValue {
  // Reactive state
  activeProvider: MediaProviderId;
  playback: MediaPlaybackState;
  queue: MediaItem[];
  currentIndex: number;
  dockMode: MediaDockMode;

  // Adapter mounting (for host components)
  mountYouTube: (element: HTMLElement) => Promise<void>;
  unmountYouTube: () => void;
  mountSpotify: (element: HTMLElement) => Promise<void>;
  unmountSpotify: () => void;
  mountSoundCloud: (element: HTMLElement) => Promise<void>;
  unmountSoundCloud: () => void;
  mountAppleMusic: (element: HTMLElement) => Promise<void>;
  unmountAppleMusic: () => void;
  mountDirectAudio: (element: HTMLElement) => Promise<void>;
  unmountDirectAudio: () => void;
  mountLittAsset: (element: HTMLElement) => Promise<void>;
  unmountLittAsset: () => void;

  // Queue
  loadUrl: (input: string) => boolean;
  addToQueue: (input: string) => boolean;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  jumpTo: (index: number) => void;

  // Playback
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (milliseconds: number) => void;
  setVolume: (volume: number) => void;

  // Provider switching
  switchProvider: (provider: MediaProviderId) => void;

  // Dock mode
  setDockMode: (mode: MediaDockMode) => void;
  showCollapsed: () => void;
  showExpanded: () => void;
  hide: () => void;
}

const MediaHubContext = createContext<MediaHubContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────

export function MediaHubProvider({ children }: { children: ReactNode }) {
  const youtubeRef = useRef<YouTubeMediaAdapter | null>(null);
  const spotifyRef = useRef<SpotifyMediaAdapter | null>(null);
  const soundcloudRef = useRef<SoundCloudMediaAdapter | null>(null);
  const appleMusicRef = useRef<AppleMusicMediaAdapter | null>(null);
  const directAudioRef = useRef<DirectAudioAdapter | null>(null);
  const littAssetRef = useRef<LittAssetAdapter | null>(null);

  // Create adapters on mount
  useEffect(() => {
    if (!youtubeRef.current) youtubeRef.current = new YouTubeMediaAdapter();
    if (!spotifyRef.current) spotifyRef.current = new SpotifyMediaAdapter();
    if (!soundcloudRef.current) soundcloudRef.current = new SoundCloudMediaAdapter();
    if (!appleMusicRef.current) appleMusicRef.current = new AppleMusicMediaAdapter();
    if (!directAudioRef.current) directAudioRef.current = new DirectAudioAdapter();
    if (!littAssetRef.current) littAssetRef.current = new LittAssetAdapter();
    return () => {
      youtubeRef.current?.destroy();
      spotifyRef.current?.destroy();
      soundcloudRef.current?.destroy();
      appleMusicRef.current?.destroy();
      directAudioRef.current?.destroy();
      littAssetRef.current?.destroy();
    };
  }, []);

  // ── Reactive state ────────────────────────────────────────────

  const [activeProvider, setActiveProvider] = useState<MediaProviderId>("youtube");
  const [playback, setPlayback] = useState<MediaPlaybackState>({
    status: "idle",
    item: null,
    positionMs: 0,
    durationMs: 0,
    volume: DEFAULT_VOLUME,
    muted: false,
    error: null,
  });
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [dockMode, setDockModeState] = useState<MediaDockMode>("hidden");

  // ── Persistence ───────────────────────────────────────────────

  const persist = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const state: MediaPersistedState = {
        activeProvider,
        queue,
        currentIndex,
        volume: playback.volume,
        muted: playback.muted,
        dockMode,
        currentItem: playback.item,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked — non-fatal
    }
  }, [activeProvider, queue, currentIndex, playback, dockMode]);

  // Load persisted state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as MediaPersistedState;
      if (saved.activeProvider) setActiveProvider(saved.activeProvider);
      if (saved.queue) setQueue(saved.queue);
      if (typeof saved.currentIndex === "number") setCurrentIndex(saved.currentIndex);
      if (typeof saved.volume === "number") {
        setPlayback((prev) => ({ ...prev, volume: saved.volume }));
      }
      if (typeof saved.muted === "boolean") {
        setPlayback((prev) => ({ ...prev, muted: saved.muted }));
      }
      if (saved.dockMode) setDockModeState(saved.dockMode);
    } catch {
      // corrupted storage
    }
  }, []);

  // Persist on state change
  useEffect(() => { persist(); }, [persist]);

  // ── Subscribe to active adapter ───────────────────────────────

  useEffect(() => {
    const adapter = getAdapter(activeProvider);
    if (!adapter) return;
    const unsub = adapter.subscribe((state) => {
      setPlayback(state);
    });
    return unsub;
  }, [activeProvider]);

  // ── Helper: get adapter by provider id ────────────────────────

  function getAdapter(provider: MediaProviderId): MediaAdapter | null {
    if (provider === "youtube") return youtubeRef.current;
    if (provider === "spotify") return spotifyRef.current;
    if (provider === "soundcloud") return soundcloudRef.current;
    if (provider === "apple-music") return appleMusicRef.current;
    if (provider === "direct") return directAudioRef.current;
    if (provider === "litt") return littAssetRef.current;
    return null;
  }

  // ── Adapter mounting ──────────────────────────────────────────

  const mountYouTube = useCallback(async (element: HTMLElement) => {
    if (!youtubeRef.current) return;
    await youtubeRef.current.mount(element);
    // Apply current volume
    youtubeRef.current.setVolume(playback.volume);
  }, [playback.volume]);

  const unmountYouTube = useCallback(() => {
    youtubeRef.current?.destroy();
  }, []);

  const mountSpotify = useCallback(async (element: HTMLElement) => {
    if (!spotifyRef.current) return;
    await spotifyRef.current.mount(element);
    spotifyRef.current.setVolume(playback.volume);
  }, [playback.volume]);

  const unmountSpotify = useCallback(() => {
    spotifyRef.current?.destroy();
  }, []);

  const mountSoundCloud = useCallback(async (element: HTMLElement) => {
    if (!soundcloudRef.current) return;
    await soundcloudRef.current.mount(element);
    soundcloudRef.current.setVolume(playback.volume);
  }, [playback.volume]);

  const unmountSoundCloud = useCallback(() => {
    soundcloudRef.current?.destroy();
  }, []);

  const mountAppleMusic = useCallback(async (element: HTMLElement) => {
    if (!appleMusicRef.current) return;
    await appleMusicRef.current.mount(element);
    appleMusicRef.current.setVolume(playback.volume);
  }, [playback.volume]);

  const unmountAppleMusic = useCallback(() => {
    appleMusicRef.current?.destroy();
  }, []);

  const mountDirectAudio = useCallback(async (element: HTMLElement) => {
    if (!directAudioRef.current) return;
    await directAudioRef.current.mount(element);
    directAudioRef.current.setVolume(playback.volume);
  }, [playback.volume]);

  const unmountDirectAudio = useCallback(() => {
    directAudioRef.current?.destroy();
  }, []);

  const mountLittAsset = useCallback(async (element: HTMLElement) => {
    if (!littAssetRef.current) return;
    await littAssetRef.current.mount(element);
    littAssetRef.current.setVolume(playback.volume);
  }, [playback.volume]);

  const unmountLittAsset = useCallback(() => {
    littAssetRef.current?.destroy();
  }, []);

  // ── Queue management ──────────────────────────────────────────

  const loadUrl = useCallback((input: string): boolean => {
    let item: MediaItem;
    try {
      item = parseMediaUrl(input);
    } catch {
      return false;
    }

    // Set as the only item in the queue
    setQueue([item]);
    setCurrentIndex(0);

    // Switch to the correct provider if needed
    if (item.provider !== activeProvider) {
      const currentAdapter = getAdapter(activeProvider);
      currentAdapter?.pause();
      setActiveProvider(item.provider);
    }

    // Load into the adapter
    const adapter = getAdapter(item.provider);
    if (adapter) {
      void adapter.load(item);
    }

    // Show the dock
    if (dockMode === "hidden") setDockModeState("collapsed");

    return true;
  }, [activeProvider, dockMode, getAdapter]);

  const addToQueue = useCallback((input: string): boolean => {
    let item: MediaItem;
    try {
      item = parseMediaUrl(input);
    } catch {
      return false;
    }

    setQueue((prev) => [...prev, item]);
    return true;
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setCurrentIndex((prev) => {
      if (index < prev) return prev - 1;
      if (index === prev) return Math.min(prev, queue.length - 2);
      return prev;
    });
  }, [queue.length]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentIndex(-1);
    const adapter = getAdapter(activeProvider);
    adapter?.pause();
  }, [activeProvider, getAdapter]);

  const jumpTo = useCallback((index: number) => {
    if (index < 0 || index >= queue.length) return;
    const item = queue[index];
    setCurrentIndex(index);

    // Switch provider if needed
    if (item.provider !== activeProvider) {
      const currentAdapter = getAdapter(activeProvider);
      currentAdapter?.pause();
      setActiveProvider(item.provider);
    }

    const adapter = getAdapter(item.provider);
    if (adapter) void adapter.load(item);
  }, [queue, activeProvider, getAdapter]);

  // ── Playback ──────────────────────────────────────────────────

  const play = useCallback(() => {
    getAdapter(activeProvider)?.play();
  }, [activeProvider, getAdapter]);

  const pause = useCallback(() => {
    getAdapter(activeProvider)?.pause();
  }, [activeProvider, getAdapter]);

  const toggle = useCallback(() => {
    getAdapter(activeProvider)?.toggle();
  }, [activeProvider, getAdapter]);

  const next = useCallback(() => {
    if (queue.length === 0) return;
    const nextIndex = (currentIndex + 1) % queue.length;
    jumpTo(nextIndex);
  }, [queue.length, currentIndex, jumpTo]);

  const previous = useCallback(() => {
    if (queue.length === 0) return;
    const prevIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;
    jumpTo(prevIndex);
  }, [queue.length, currentIndex, jumpTo]);

  const seek = useCallback((milliseconds: number) => {
    const adapter = getAdapter(activeProvider);
    adapter?.seek?.(milliseconds);
  }, [activeProvider, getAdapter]);

  const setVolume = useCallback((volume: number) => {
    const v = Math.max(0, Math.min(100, volume));
    setPlayback((prev) => ({ ...prev, volume: v, muted: v === 0 }));
    getAdapter(activeProvider)?.setVolume?.(v);
  }, [activeProvider, getAdapter]);

  // ── Provider switching ────────────────────────────────────────

  const switchProvider = useCallback((provider: MediaProviderId) => {
    if (provider === activeProvider) return;
    const currentAdapter = getAdapter(activeProvider);
    currentAdapter?.pause();
    setActiveProvider(provider);
  }, [activeProvider, getAdapter]);

  // ── Dock mode ─────────────────────────────────────────────────

  const setDockMode = useCallback((mode: MediaDockMode) => {
    setDockModeState(mode);
  }, []);

  const showCollapsed = useCallback(() => setDockModeState("collapsed"), []);
  const showExpanded = useCallback(() => setDockModeState("expanded"), []);
  const hide = useCallback(() => setDockModeState("hidden"), []);

  // ── Value ─────────────────────────────────────────────────────

  const value = useMemo<MediaHubContextValue>(() => ({
    activeProvider,
    playback,
    queue,
    currentIndex,
    dockMode,
    mountYouTube,
    unmountYouTube,
    mountSpotify,
    unmountSpotify,
    mountSoundCloud,
    unmountSoundCloud,
    mountAppleMusic,
    unmountAppleMusic,
    mountDirectAudio,
    unmountDirectAudio,
    mountLittAsset,
    unmountLittAsset,
    loadUrl,
    addToQueue,
    removeFromQueue,
    clearQueue,
    jumpTo,
    play,
    pause,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    switchProvider,
    setDockMode,
    showCollapsed,
    showExpanded,
    hide,
  }), [
    activeProvider, playback, queue, currentIndex, dockMode,
    mountYouTube, unmountYouTube, mountSpotify, unmountSpotify,
    mountSoundCloud, unmountSoundCloud, mountAppleMusic, unmountAppleMusic,
    mountDirectAudio, unmountDirectAudio, mountLittAsset, unmountLittAsset,
    loadUrl, addToQueue, removeFromQueue, clearQueue, jumpTo,
    play, pause, toggle, next, previous, seek, setVolume,
    switchProvider, setDockMode, showCollapsed, showExpanded, hide,
  ]);

  return (
    <MediaHubContext.Provider value={value}>
      {children}
    </MediaHubContext.Provider>
  );
}

export function useMediaHub(): MediaHubContextValue {
  const ctx = useContext(MediaHubContext);
  if (!ctx) {
    throw new Error("useMediaHub must be used within MediaHubProvider");
  }
  return ctx;
}
