"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Radio,
} from "lucide-react";
import {
  DEFAULT_PLAYLIST,
  loadMusicPreferences,
  saveMusicPreferences,
  type MusicTrack,
} from "@/lib/music";

interface MusicPlayerProps {
  mode?: "mini" | "full";
  initialTrackId?: string;
}

function isYouTubeUrl(url: string) {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

function CoverArt({
  track,
  size,
  accent,
}: {
  track: MusicTrack | null;
  size: number;
  accent: string;
}) {
  if (track?.cover) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={track.cover}
        alt={track.title}
        className="rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-lg flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${accent}40, ${accent}10)`,
        border: `1px solid ${accent}30`,
      }}
    >
      <Music size={size * 0.4} style={{ color: accent, opacity: 0.7 }} />
    </div>
  );
}

export default function MusicPlayer({
  mode = "mini",
  initialTrackId,
}: MusicPlayerProps) {
  const { resolvedColors: T } = useTheme();
  const audioRef = useRef<HTMLAudioElement>(null);

  const resolvedIdxRef = useRef<number | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => loadMusicPreferences().volume ?? 70);
  const [muted, setMuted] = useState(false);

  const currentTrack = tracks[currentIdx] ?? null;

  useEffect(() => {
    const prefs = loadMusicPreferences();
    const targetId = initialTrackId ?? prefs.lastTrackId ?? null;
    const load = async () => {
      let list: MusicTrack[] = [];
      try {
        const res = await fetch("/api/tracks");
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        list = data.tracks ?? data ?? [];
      } catch { /* fall through */ }
      if (list.length === 0) list = DEFAULT_PLAYLIST;
      if (targetId) {
        const idx = list.findIndex((t) => t.id === targetId);
        if (idx >= 0) resolvedIdxRef.current = idx;
      }
      setTracks(list);
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentTrackIdForEffect = currentIdx;
  useEffect(() => {
    if (resolvedIdxRef.current !== null) {
      const idx = resolvedIdxRef.current;
      resolvedIdxRef.current = null;
      if (idx !== currentTrackIdForEffect) setCurrentIdx(idx);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || isYouTubeUrl(currentTrack.url)) return;
    audio.src = currentTrack.url;
    audio.volume = (muted ? 0 : volume) / 100;
    if (playing) audio.play().catch(() => setPlaying(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, tracks]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = (muted ? 0 : volume) / 100;
    const base = loadMusicPreferences();
    saveMusicPreferences({
      ...base,
      volume,
      lastTrackId: currentTrack?.id,
      autoPlay: playing,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, muted]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setProgress(audio.currentTime);
    setDuration(audio.duration || 0);
  }, []);

  const handleEnded = useCallback(() => {
    setCurrentIdx((i) => (i + 1) % tracks.length);
    setPlaying(true);
  }, [tracks.length]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || isYouTubeUrl(currentTrack.url)) {
      setPlaying((p) => !p);
      return;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const prev = () => setCurrentIdx((i) => (i - 1 + tracks.length) % tracks.length);
  const next = () => setCurrentIdx((i) => (i + 1) % tracks.length);

  const seek = (val: number) => {
    const audio = audioRef.current;
    if (audio && duration) { audio.currentTime = val; setProgress(val); }
  };

  const accent = "#ff00a0";

  if (tracks.length === 0) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ backgroundColor: `${T.boxBg}60` }}>
        <Music size={16} style={{ color: T.textMuted }} />
        <span className="text-xs" style={{ color: T.textMuted }}>Loading tracks…</span>
      </div>
    );
  }

  /* ---- MINI MODE ---- */
  if (mode === "mini") {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
        style={{
          backgroundColor: `${T.boxBg}80`,
          border: `1px solid ${accent}20`,
        }}
      >
        <audio
          ref={audioRef}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          preload="metadata"
        />
        <CoverArt track={currentTrack} size={40} accent={accent} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>
            {currentTrack?.title ?? "—"}
          </div>
          <div className="text-[10px] truncate" style={{ color: T.textMuted }}>
            {currentTrack?.artist ?? "—"}
          </div>
          {!isYouTubeUrl(currentTrack?.url ?? "") && duration > 0 && (
            <input
              type="range"
              min={0}
              max={duration}
              value={progress}
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full h-0.5 mt-1 accent-pink-500"
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={prev} className="p-1 hover:opacity-70" style={{ color: T.textMuted }}>
            <SkipBack size={13} />
          </button>
          <button
            onClick={togglePlay}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
            style={{ backgroundColor: accent, color: "#000" }}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button onClick={next} className="p-1 hover:opacity-70" style={{ color: T.textMuted }}>
            <SkipForward size={13} />
          </button>
        </div>
      </div>
    );
  }

  /* ---- FULL MODE ---- */
  return (
    <div
      className="rounded-2xl p-6 space-y-6"
      style={{
        backgroundColor: `${T.boxBg}80`,
        border: `1px solid ${accent}20`,
      }}
    >
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        preload="metadata"
      />

      {/* Current track */}
      <div className="flex items-center gap-4">
        <CoverArt track={currentTrack} size={72} accent={accent} />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-black truncate" style={{ color: T.textColor }}>
            {currentTrack?.title ?? "—"}
          </div>
          <div className="text-sm truncate" style={{ color: T.textMuted }}>
            {currentTrack?.artist ?? "—"}
          </div>
          {currentTrack?.isLive && (
            <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ backgroundColor: "#ff000030", color: "#ff4444" }}>
              <Radio size={8} /> Live
            </span>
          )}
        </div>
      </div>

      {/* Progress */}
      {!isYouTubeUrl(currentTrack?.url ?? "") && (
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={progress}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full h-1 rounded-full accent-pink-500"
          />
          <div className="flex justify-between text-[10px]" style={{ color: T.textMuted }}>
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={prev} className="p-2 hover:opacity-70 transition-opacity" style={{ color: T.textMuted }}>
          <SkipBack size={20} />
        </button>
        <button
          onClick={togglePlay}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-105"
          style={{ backgroundColor: accent, color: "#000", boxShadow: `0 0 20px ${accent}50` }}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button onClick={next} className="p-2 hover:opacity-70 transition-opacity" style={{ color: T.textMuted }}>
          <SkipForward size={20} />
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-3">
        <button onClick={() => setMuted((m) => !m)} style={{ color: T.textMuted }}>
          {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : volume}
          onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }}
          className="flex-1 h-1 accent-pink-500"
        />
        <span className="text-[10px] w-7 text-right" style={{ color: T.textMuted }}>{muted ? 0 : volume}%</span>
      </div>

      {/* Queue */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Queue</div>
        {tracks.map((t, i) => (
          <button
            key={t.id}
            onClick={() => { setCurrentIdx(i); setPlaying(true); }}
            className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left transition-all hover:opacity-80"
            style={{
              backgroundColor: i === currentIdx ? `${accent}15` : "transparent",
              border: i === currentIdx ? `1px solid ${accent}20` : "1px solid transparent",
            }}
          >
            <span className="text-[10px] w-5 text-right shrink-0" style={{ color: T.textMuted }}>{i + 1}</span>
            <CoverArt track={t} size={28} accent={accent} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold truncate" style={{ color: i === currentIdx ? accent : T.textColor }}>{t.title}</div>
              <div className="text-[10px] truncate" style={{ color: T.textMuted }}>{t.artist}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
