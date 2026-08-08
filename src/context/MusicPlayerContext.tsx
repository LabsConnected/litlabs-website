"use client";

/**
 * MusicPlayerContext — a single shared audio element that survives tool
 * switches inside the Studio. The player bar reads from this context so
 * music keeps playing while the user moves between Create / Library / Chat.
 *
 * Audio is streamed via /api/music/tracks/{id}/stream (signed URL resolved
 * server-side). The raw storage key never reaches the client.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { apiFetch, type ApiJson } from "@/lib/api-response";

export interface PlayerTrack {
  id: string;
  title: string;
  version_label?: string;
  duration?: number | null;
  bpm?: number | null;
  musical_key?: string | null;
  visibility?: "private" | "unlisted" | "public";
  blueprint?: {
    genre?: string[];
    mood?: string[];
    instrumental?: boolean;
  } | null;
  provider?: string;
  created_at?: string;
}

type RepeatMode = "off" | "all" | "one";

interface MusicPlayerState {
  queue: PlayerTrack[];
  currentIdx: number;
  current: PlayerTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  loadingUrl: boolean;
}

interface MusicPlayerContextValue extends MusicPlayerState {
  playTrack: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setQueue: (tracks: PlayerTrack[]) => void;
  removeFromQueue: (idx: number) => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

const STORAGE_KEY = "littree:music-player:prefs";

interface StoredPrefs {
  volume: number;
  lastTrackId: string | null;
}

function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      return {
        volume: typeof parsed.volume === "number" ? parsed.volume : 70,
        lastTrackId: parsed.lastTrackId ?? null,
      };
    }
  } catch {
    // ignore
  }
  return { volume: 70, lastTrackId: null };
}

function savePrefs(prefs: StoredPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueueState] = useState<PlayerTrack[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => loadPrefs().volume);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [loadingUrl, setLoadingUrl] = useState(false);

  const current = queue[currentIdx] ?? null;

  // Lazily create the single audio element.
  const getAudio = useCallback(() => {
    if (!audioRef.current && typeof Audio !== "undefined") {
      const el = new Audio();
      el.preload = "metadata";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  // Resolve a stream URL for a track id.
  const resolveStreamUrl = useCallback(async (trackId: string): Promise<string | null> => {
    try {
      const data = await apiFetch<ApiJson>(`/api/music/tracks/${trackId}/stream`, {
        credentials: "include",
      });
      return (data.url as string) ?? null;
    } catch {
      return null;
    }
  }, []);

  // Load + play a track by id (resolves signed URL).
  const loadAndPlay = useCallback(
    async (track: PlayerTrack) => {
      const audio = getAudio();
      if (!audio) return;
      setLoadingUrl(true);
      const url = await resolveStreamUrl(track.id);
      setLoadingUrl(false);
      if (!url) {
        setIsPlaying(false);
        return;
      }
      audio.src = url;
      audio.volume = (muted ? 0 : volume) / 100;
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      savePrefs({ volume, lastTrackId: track.id });
    },
    [getAudio, resolveStreamUrl, muted, volume],
  );

  // When currentIdx changes (and we have a current track + are playing), load it.
  // We drive loads explicitly from playTrack/next/prev to avoid reloading on
  // every queue shuffle. This effect only handles the initial restore.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (queue.length === 0) return;
    const prefs = loadPrefs();
    if (!prefs.lastTrackId) {
      restoredRef.current = true;
      return;
    }
    const idx = queue.findIndex((t) => t.id === prefs.lastTrackId);
    if (idx >= 0) {
      setCurrentIdx(idx);
      // Restore metadata only — do NOT autoplay (browser policy + UX).
      const audio = getAudio();
      if (audio) {
        void resolveStreamUrl(queue[idx].id).then((url) => {
          if (url && audio) audio.src = url;
        });
      }
    }
    restoredRef.current = true;
  }, [queue, getAudio, resolveStreamUrl]);

  // Audio element event listeners.
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;

    const onTime = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (repeat === "one") {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
        return;
      }
      // Advance via the context's next() — replicate logic inline to avoid
      // stale closure; we read from refs below.
      setCurrentIdx((idx) => {
        const len = queue.length;
        if (len === 0) return idx;
        if (shuffle) {
          return Math.floor(Math.random() * len);
        }
        const n = idx + 1;
        if (n >= len) {
          return repeat === "all" ? 0 : idx;
        }
        return n;
      });
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [getAudio, repeat, shuffle, queue.length]);

  // After onEnded advances currentIdx, load the new track if we should keep playing.
  const lastLoadedIdxRef = useRef<number>(-1);
  useEffect(() => {
    if (!current) return;
    if (lastLoadedIdxRef.current === currentIdx) return;
    // Only auto-advance-load when we were already playing (ended → next).
    if (isPlaying || lastLoadedIdxRef.current !== -1) {
      lastLoadedIdxRef.current = currentIdx;
      void loadAndPlay(current);
    }
  }, [currentIdx, current, isPlaying, loadAndPlay]);

  // Volume sync.
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    audio.volume = (muted ? 0 : volume) / 100;
    savePrefs({ volume, lastTrackId: current?.id ?? null });
  }, [volume, muted, current, getAudio]);

  const playTrack = useCallback(
    (track: PlayerTrack, newQueue?: PlayerTrack[]) => {
      if (newQueue && newQueue.length > 0) {
        const idx = newQueue.findIndex((t) => t.id === track.id);
        const startIdx = idx >= 0 ? idx : 0;
        setQueueState(newQueue);
        setCurrentIdx(startIdx);
        lastLoadedIdxRef.current = startIdx;
        void loadAndPlay(track);
      } else {
        // Same queue — if same track, toggle; else find/append.
        const existingIdx = queue.findIndex((t) => t.id === track.id);
        if (existingIdx >= 0 && existingIdx === currentIdx) {
          const audio = getAudio();
          if (audio) {
            if (audio.paused) {
              void audio.play().then(() => setIsPlaying(true)).catch(() => {});
            } else {
              audio.pause();
              setIsPlaying(false);
            }
          }
          return;
        }
        if (existingIdx >= 0) {
          setCurrentIdx(existingIdx);
          lastLoadedIdxRef.current = existingIdx;
        } else {
          setQueueState((q) => {
            const nq = [...q, track];
            setCurrentIdx(nq.length - 1);
            lastLoadedIdxRef.current = nq.length - 1;
            return nq;
          });
        }
        void loadAndPlay(track);
      }
    },
    [queue, currentIdx, getAudio, loadAndPlay],
  );

  const togglePlay = useCallback(() => {
    const audio = getAudio();
    if (!audio || !current) return;
    if (audio.paused) {
      void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [getAudio, current]);

  const next = useCallback(() => {
    if (queue.length === 0) return;
    if (shuffle) {
      setCurrentIdx(Math.floor(Math.random() * queue.length));
    } else {
      setCurrentIdx((i) => (i + 1) % queue.length);
    }
    setIsPlaying(true);
  }, [queue.length, shuffle]);

  const seek = useCallback(
    (time: number) => {
      const audio = getAudio();
      if (audio && duration) {
        audio.currentTime = time;
        setCurrentTime(time);
      }
    },
    [getAudio, duration],
  );

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    if (currentTime > 3) {
      const audio = getAudio();
      if (audio) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      return;
    }
    setCurrentIdx((i) => (i - 1 + queue.length) % queue.length);
    setIsPlaying(true);
  }, [queue.length, currentTime, getAudio]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (v > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    [],
  );

  const setQueue = useCallback((tracks: PlayerTrack[]) => {
    setQueueState(tracks);
    if (tracks.length === 0) {
      setCurrentIdx(0);
      const audio = getAudio();
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      setIsPlaying(false);
    }
  }, [getAudio]);

  const removeFromQueue = useCallback((idx: number) => {
    setQueueState((q) => {
      const nq = q.filter((_, i) => i !== idx);
      if (idx < currentIdx) setCurrentIdx((c) => c - 1);
      else if (idx === currentIdx) {
        setCurrentIdx((c) => Math.min(c, Math.max(0, nq.length - 1)));
        const audio = getAudio();
        if (audio) {
          audio.pause();
          setIsPlaying(false);
        }
      }
      return nq;
    });
  }, [currentIdx, getAudio]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const value: MusicPlayerContextValue = {
    queue,
    currentIdx,
    current,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    loadingUrl,
    playTrack,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    setQueue,
    removeFromQueue,
  };

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>;
}

export function useMusicPlayer() {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) {
    throw new Error("useMusicPlayer must be used within MusicPlayerProvider");
  }
  return ctx;
}

export function useMusicPlayerOptional() {
  return useContext(MusicPlayerContext);
}
