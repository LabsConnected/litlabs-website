"use client";

/**
 * YouTubePlayerContext — React context provider wrapping the
 * YouTubePlayerController. Mounted in the root authenticated layout
 * so the player survives navigation between Dashboard, Studio, Create,
 * Assets, and Missions.
 *
 * The controller instance is stored in a ref and persists across
 * re-renders and route changes. Only ONE player exists at a time.
 *
 * @see src/lib/youtube/YouTubePlayerController.ts
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { YouTubePlayerController } from "@/lib/youtube/YouTubePlayerController";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type {
  YTPlayerState,
  YTQueueItem,
  YTDockMode,
  YTPlayerError,
} from "@/lib/youtube/types";

export interface YouTubePlayerContextValue {
  // Reactive state
  state: YTPlayerState;
  queue: YTQueueItem[];
  currentIndex: number;
  currentVideo: YTQueueItem | null;
  volume: number;
  muted: boolean;
  dockMode: YTDockMode;
  currentTime: number;
  duration: number;
  currentVideoId: string | null;
  currentTitle: string;
  currentChannel: string;
  error: YTPlayerError | null;
  isPlaying: boolean;
  isReady: boolean;

  // Player mounting
  mountPlayer: (div: HTMLDivElement) => Promise<void>;
  unmountPlayer: () => void;

  // Queue
  loadVideo: (input: string) => boolean;
  addToQueue: (input: string) => boolean;
  loadPlaylist: (input: string) => boolean;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  jumpTo: (index: number) => void;

  // Playback
  play: () => void;
  pause: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;

  // Dock mode
  setDockMode: (mode: YTDockMode) => void;
  showDocked: () => void;
  showMini: () => void;
  showExpanded: () => void;
  hide: () => void;
}

const YouTubePlayerContext = createContext<YouTubePlayerContextValue | null>(null);

export function YouTubePlayerProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<YouTubePlayerController | null>(null);
  const { userId } = useClerkAuth();

  // Create controller on mount
  useEffect(() => {
    if (!controllerRef.current) {
      controllerRef.current = new YouTubePlayerController();
    }
  }, []);

  // Set user ID for persistence
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setUserId(userId ?? null);
    }
  }, [userId]);

  // Reactive state
  const [state, setState] = useState<YTPlayerState>("idle");
  const [queue, setQueue] = useState<YTQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [volume, setVolumeState] = useState(70);
  const [muted, setMuted] = useState(false);
  const [dockMode, setDockModeState] = useState<YTDockMode>("hidden");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState("");
  const [currentChannel, setCurrentChannel] = useState("");
  const [error, setError] = useState<YTPlayerError | null>(null);

  // Subscribe to controller events
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    const unsubscribe = controller.on((event) => {
      switch (event.type) {
        case "stateChange":
          setState(event.state);
          if (event.state !== "error") setError(null);
          break;
        case "queueChange":
          setQueue(event.queue);
          setCurrentIndex(event.currentIndex);
          break;
        case "dockModeChange":
          setDockModeState(event.mode);
          break;
        case "volumeChange":
          setVolumeState(event.volume);
          setMuted(event.muted);
          break;
        case "progressChange":
          setCurrentTime(event.currentTime);
          setDuration(event.duration);
          break;
        case "videoDataChange":
          setCurrentVideoId(event.videoId);
          setCurrentTitle(event.title);
          setCurrentChannel(event.channel);
          break;
        case "error":
          setError(event.error);
          break;
      }
    });

    return unsubscribe;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.destroyPlayer();
    };
  }, []);

  // Mount / unmount
  const mountPlayer = useCallback(async (div: HTMLDivElement) => {
    if (!controllerRef.current) return;
    await controllerRef.current.createPlayer(div);
  }, []);

  const unmountPlayer = useCallback(() => {
    controllerRef.current?.destroyPlayer();
  }, []);

  // Queue methods
  const loadVideo = useCallback((input: string) => {
    return controllerRef.current?.loadVideo(input) ?? false;
  }, []);

  const addToQueue = useCallback((input: string) => {
    return controllerRef.current?.addToQueue(input) ?? false;
  }, []);

  const loadPlaylist = useCallback((input: string) => {
    return controllerRef.current?.loadPlaylist(input) ?? false;
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    controllerRef.current?.removeFromQueue(index);
  }, []);

  const clearQueue = useCallback(() => {
    controllerRef.current?.clearQueue();
  }, []);

  const jumpTo = useCallback((index: number) => {
    controllerRef.current?.jumpTo(index);
  }, []);

  // Playback
  const play = useCallback(() => controllerRef.current?.play(), []);
  const pause = useCallback(() => controllerRef.current?.pause(), []);
  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const next = useCallback(() => controllerRef.current?.next(), []);
  const previous = useCallback(() => controllerRef.current?.previous(), []);
  const seek = useCallback((seconds: number) => controllerRef.current?.seek(seconds), []);
  const setVolume = useCallback((v: number) => controllerRef.current?.setVolume(v), []);
  const toggleMute = useCallback(() => controllerRef.current?.toggleMute(), []);

  // Dock mode
  const setDockMode = useCallback((mode: YTDockMode) => controllerRef.current?.setDockMode(mode), []);
  const showDocked = useCallback(() => controllerRef.current?.showDocked(), []);
  const showMini = useCallback(() => controllerRef.current?.showMini(), []);
  const showExpanded = useCallback(() => controllerRef.current?.showExpanded(), []);
  const hide = useCallback(() => controllerRef.current?.hide(), []);

  const currentVideo = queue[currentIndex] ?? null;
  const isPlaying = state === "playing";
  const isReady = state === "ready" || state === "playing" || state === "paused" || state === "buffering";

  const value: YouTubePlayerContextValue = {
    state,
    queue,
    currentIndex,
    currentVideo,
    volume,
    muted,
    dockMode,
    currentTime,
    duration,
    currentVideoId,
    currentTitle,
    currentChannel,
    error,
    isPlaying,
    isReady,
    mountPlayer,
    unmountPlayer,
    loadVideo,
    addToQueue,
    loadPlaylist,
    removeFromQueue,
    clearQueue,
    jumpTo,
    play,
    pause,
    stop,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    setDockMode,
    showDocked,
    showMini,
    showExpanded,
    hide,
  };

  return (
    <YouTubePlayerContext.Provider value={value}>
      {children}
    </YouTubePlayerContext.Provider>
  );
}

export function useYouTubePlayer(): YouTubePlayerContextValue {
  const ctx = useContext(YouTubePlayerContext);
  if (!ctx) {
    throw new Error("useYouTubePlayer must be used within YouTubePlayerProvider");
  }
  return ctx;
}
