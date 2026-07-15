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
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  X,
  Plus,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Upload,
} from "lucide-react";
import {
  DEFAULT_PLAYLIST,
  loadMusicPreferences,
  saveMusicPreferences,
  type MusicTrack,
} from "@/lib/music";

type RepeatMode = "off" | "all" | "one";

interface MusicPlayerProps {
  mode?: "mini" | "full";
  initialTrackId?: string;
}

function isYouTubeUrl(url: string) {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

function getYouTubeEmbedUrl(url: string): string {
  const ytMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&enablejsapi=1`;
  }
  return url;
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
        className="rounded-lg object-cover shrink-0"
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
      <Music size={size * 0.38} style={{ color: accent, opacity: 0.7 }} />
    </div>
  );
}

function formatTime(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function MusicPlayer({
  mode = "mini",
  initialTrackId,
}: MusicPlayerProps) {
  const { resolvedColors: T } = useTheme();
  const audioRef = useRef<HTMLAudioElement>(null);
  const resolvedIdxRef = useRef<number | null>(null);

  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [queue, setQueue] = useState<MusicTrack[]>([]); // working copy — can be shuffled
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(
    () => loadMusicPreferences().volume ?? 70,
  );
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [showQueue, setShowQueue] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addArtist, setAddArtist] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentTrack = queue[currentIdx] ?? null;
  const isYT = isYouTubeUrl(currentTrack?.url ?? "");
  const accent = "#ff00a0";

  /* ── Load tracks ─────────────────────────────────────────────── */
  useEffect(() => {
    const prefs = loadMusicPreferences();
    const targetId = initialTrackId ?? prefs.lastTrackId ?? null;
    const load = async () => {
      let list: MusicTrack[] = [];
      try {
        const res = await fetch("/api/tracks");
        if (res.ok) {
          const data = await res.json();
          list = Array.isArray(data.tracks)
            ? data.tracks
            : Array.isArray(data)
              ? data
              : [];
        }
      } catch {
        /* fall through */
      }
      if (list.length === 0) list = DEFAULT_PLAYLIST;
      if (targetId) {
        const idx = list.findIndex((t) => t.id === targetId);
        if (idx >= 0) resolvedIdxRef.current = idx;
      }
      setTracks(list);
      setQueue([...list]);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Restore last track idx after load */
  useEffect(() => {
    if (resolvedIdxRef.current !== null && queue.length > 0) {
      const idx = resolvedIdxRef.current;
      resolvedIdxRef.current = null;
      setCurrentIdx(Math.min(idx, queue.length - 1));
    }
  }, [queue]);

  /* ── Audio source sync ───────────────────────────────────────── */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || isYT) return;
    audio.src = currentTrack.url;
    audio.volume = (muted ? 0 : volume) / 100;
    if (playing) audio.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, queue]);

  /* ── Volume sync ─────────────────────────────────────────────── */
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
    if (repeat === "one") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }
    const next = currentIdx + 1;
    if (next >= queue.length) {
      if (repeat === "all") {
        setCurrentIdx(0);
        setPlaying(true);
      } else setPlaying(false);
    } else {
      setCurrentIdx(next);
      setPlaying(true);
    }
  }, [currentIdx, queue.length, repeat]);

  /* ── Controls ────────────────────────────────────────────────── */
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || isYT) {
      setPlaying((p) => !p);
      return;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  };

  const prev = () => {
    if (progress > 3 && !isYT) {
      seek(0);
      return;
    }
    setCurrentIdx((i) => (i - 1 + queue.length) % queue.length);
    setPlaying(true);
  };

  const next = useCallback(() => {
    if (shuffle) {
      const idx = Math.floor(Math.random() * queue.length);
      setCurrentIdx(idx);
    } else {
      setCurrentIdx((i) => (i + 1) % queue.length);
    }
    setPlaying(true);
  }, [shuffle, queue.length]);

  const seek = (val: number) => {
    const audio = audioRef.current;
    if (audio && duration) {
      audio.currentTime = val;
      setProgress(val);
    }
  };

  const cycleRepeat = () =>
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));

  const toggleShuffle = () => {
    setShuffle((s) => {
      const next = !s;
      if (next) {
        const current = queue[currentIdx];
        const rest = queue.filter((_, i) => i !== currentIdx);
        const shuffled = rest.sort(() => Math.random() - 0.5);
        setQueue([current, ...shuffled]);
        setCurrentIdx(0);
      } else {
        setQueue([...tracks]);
        const newIdx = tracks.findIndex((t) => t.id === currentTrack?.id);
        setCurrentIdx(Math.max(0, newIdx));
      }
      return next;
    });
  };

  const removeFromQueue = (idx: number) => {
    setQueue((q) => {
      const next = q.filter((_, i) => i !== idx);
      if (idx < currentIdx) setCurrentIdx((c) => c - 1);
      else if (idx === currentIdx && idx >= next.length)
        setCurrentIdx(Math.max(0, next.length - 1));
      return next;
    });
  };

  const addCustomTrack = () => {
    if (!addUrl.trim()) return;
    const track: MusicTrack = {
      id: `custom-${Date.now()}`,
      title: addTitle.trim() || "Custom Track",
      artist: addArtist.trim() || "Unknown",
      url: addUrl.trim(),
    };
    setTracks((t) => [...t, track]);
    setQueue((q) => [...q, track]);
    setAddUrl("");
    setAddTitle("");
    setAddArtist("");
    setShowAdd(false);
  };

  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      const track: MusicTrack = {
        id: `upload-${Date.now()}`,
        title: addTitle.trim() || cleanName || "Uploaded Track",
        artist: addArtist.trim() || "You",
        url: data.url,
      };
      setTracks((t) => [...t, track]);
      setQueue((q) => [...q, track]);
      setAddTitle("");
      setAddArtist("");
      setShowAdd(false);
      showUploadToast("Track uploaded and added to queue");
    } catch (reason) {
      const msg = reason instanceof Error ? reason.message : "Upload failed";
      showUploadToast(msg, "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const showUploadToast = (
    msg: string,
    type: "success" | "error" = "success",
  ) => {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: bold;
      z-index: 10000; color: ${type === "error" ? "#fff" : "#000"};
      background: ${type === "error" ? "#ef4444" : "#22d3ee"};
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  };

  const moveInQueue = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= queue.length) return;
    setQueue((q) => {
      const next = [...q];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
    if (idx === currentIdx) setCurrentIdx(newIdx);
    else if (newIdx === currentIdx) setCurrentIdx(idx);
  };

  /* ── Render helpers ──────────────────────────────────────────── */
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  if (queue.length === 0) {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2 rounded-xl"
        style={{ backgroundColor: `${T.boxBg}60` }}
      >
        <Music size={16} style={{ color: T.textMuted }} />
        <span className="text-xs" style={{ color: T.textMuted }}>
          Loading tracks…
        </span>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════
     MINI MODE
  ══════════════════════════════════════════════════════════════ */
  if (mode === "mini") {
    return (
      <div
        className="rounded-xl overflow-hidden"
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

        <div className="flex items-center gap-3 px-3 py-2.5">
          <CoverArt track={currentTrack} size={38} accent={accent} />
          <div className="flex-1 min-w-0">
            <div
              className="text-xs font-bold truncate"
              style={{ color: T.textColor }}
            >
              {currentTrack?.title ?? "—"}
            </div>
            <div
              className="text-[10px] truncate"
              style={{ color: T.textMuted }}
            >
              {currentTrack?.artist ?? "—"}
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={prev}
              className="p-2 rounded hover:bg-white/10 transition-all"
              style={{ color: T.textMuted }}
            >
              <SkipBack size={12} />
            </button>
            <button
              onClick={togglePlay}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ backgroundColor: accent, color: "#000" }}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={next}
              className="p-2 rounded hover:bg-white/10 transition-all"
              style={{ color: T.textMuted }}
            >
              <SkipForward size={12} />
            </button>
            <button
              onClick={() => setMuted((m) => !m)}
              className="p-2 rounded hover:bg-white/10 transition-all"
              style={{ color: T.textMuted }}
            >
              {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
          </div>
        </div>

        {/* Progress bar for non-YT tracks */}
        {!isYT && duration > 0 && (
          <div className="px-3 pb-2">
            <div
              className="relative h-1 rounded-full cursor-pointer"
              style={{ backgroundColor: T.borderColor + "30" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - rect.left) / rect.width) * duration);
              }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(progress / duration) * 100}%`,
                  backgroundColor: accent,
                }}
              />
            </div>
            <div
              className="flex justify-between text-[9px] mt-0.5"
              style={{ color: T.textMuted }}
            >
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        )}

        {/* YT embed (hidden, audio only intent) */}
        {isYT && playing && (
          <iframe
            src={getYouTubeEmbedUrl(currentTrack?.url ?? "")}
            className="w-0 h-0 absolute opacity-0 pointer-events-none"
            allow="autoplay"
            title="yt-audio"
          />
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════
     FULL MODE
  ══════════════════════════════════════════════════════════════ */
  return (
    <div
      className="rounded-2xl overflow-hidden"
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

      {/* Hero area */}
      <div
        className="p-6 pb-4"
        style={{
          background: `linear-gradient(180deg, ${accent}10 0%, transparent 100%)`,
        }}
      >
        <div className="flex items-center gap-4 mb-4">
          <CoverArt track={currentTrack} size={80} accent={accent} />
          <div className="flex-1 min-w-0">
            <div
              className="text-lg font-black truncate"
              style={{ color: T.textColor }}
            >
              {currentTrack?.title ?? "—"}
            </div>
            <div
              className="text-sm truncate mb-1"
              style={{ color: T.textMuted }}
            >
              {currentTrack?.artist ?? "—"}
            </div>
            <div className="flex items-center gap-2">
              {currentTrack?.genre && (
                <span
                  className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: accent + "20", color: accent }}
                >
                  {currentTrack.genre}
                </span>
              )}
              {currentTrack?.isLive && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "#ff000030", color: "#ff4444" }}
                >
                  <Radio size={8} /> Live
                </span>
              )}
              {isYT && (
                <a
                  href={currentTrack?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[9px] font-bold hover:opacity-70"
                  style={{ color: T.textMuted }}
                >
                  <ExternalLink size={9} /> YouTube
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Progress scrubber */}
        {!isYT ? (
          <div className="space-y-1 mb-4">
            <div
              className="relative h-2 rounded-full cursor-pointer group"
              style={{ backgroundColor: T.borderColor + "30" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - rect.left) / rect.width) * (duration || 1));
              }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${duration ? (progress / duration) * 100 : 0}%`,
                  backgroundColor: accent,
                  boxShadow: `0 0 8px ${accent}60`,
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  left: `calc(${duration ? (progress / duration) * 100 : 0}% - 6px)`,
                  backgroundColor: accent,
                  boxShadow: `0 0 8px ${accent}`,
                }}
              />
            </div>
            <div
              className="flex justify-between text-[10px]"
              style={{ color: T.textMuted }}
            >
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        ) : (
          <div className="mb-4">
            {playing && (
              <iframe
                src={getYouTubeEmbedUrl(currentTrack?.url ?? "")}
                className="w-0 h-0 absolute opacity-0 pointer-events-none"
                allow="autoplay"
                title="yt-audio"
              />
            )}
            <div
              className="text-[10px] text-center py-1 rounded-lg"
              style={{
                color: T.textMuted,
                backgroundColor: T.borderColor + "15",
              }}
            >
              ▶ Streaming via YouTube — progress unavailable
            </div>
          </div>
        )}

        {/* Main controls */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <button
            onClick={toggleShuffle}
            className="p-2 rounded-lg transition-all hover:bg-white/10"
            style={{ color: shuffle ? accent : T.textMuted }}
            title="Shuffle"
          >
            <Shuffle size={16} />
          </button>
          <button
            onClick={prev}
            className="p-2 rounded-lg hover:bg-white/10 transition-all"
            style={{ color: T.textColor }}
          >
            <SkipBack size={20} />
          </button>
          <button
            onClick={togglePlay}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
            style={{
              backgroundColor: accent,
              color: "#000",
              boxShadow: `0 0 24px ${accent}50`,
            }}
          >
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button
            onClick={next}
            className="p-2 rounded-lg hover:bg-white/10 transition-all"
            style={{ color: T.textColor }}
          >
            <SkipForward size={20} />
          </button>
          <button
            onClick={cycleRepeat}
            className="p-2 rounded-lg transition-all hover:bg-white/10"
            style={{ color: repeat !== "off" ? accent : T.textMuted }}
            title={`Repeat: ${repeat}`}
          >
            <RepeatIcon size={16} />
          </button>
        </div>

        {/* Volume row */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMuted((m) => !m)}
            className="shrink-0"
            style={{ color: T.textMuted }}
          >
            {muted || volume === 0 ? (
              <VolumeX size={15} />
            ) : (
              <Volume2 size={15} />
            )}
          </button>
          <div
            className="relative flex-1 h-2 rounded-full cursor-pointer"
            style={{ backgroundColor: T.borderColor + "30" }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const v = Math.round(
                ((e.clientX - rect.left) / rect.width) * 100,
              );
              setVolume(Math.max(0, Math.min(100, v)));
              setMuted(false);
            }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${muted ? 0 : volume}%`,
                backgroundColor: T.textMuted,
              }}
            />
          </div>
          <span
            className="text-[10px] w-8 text-right shrink-0"
            style={{ color: T.textMuted }}
          >
            {muted ? 0 : volume}%
          </span>
        </div>
      </div>

      {/* Queue + Add track */}
      <div style={{ borderTop: `1px solid ${T.borderColor}15` }}>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2">
          <button
            onClick={() => setShowQueue((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest transition-all hover:opacity-80"
            style={{ color: showQueue ? accent : T.textMuted }}
          >
            <ListMusic size={12} /> Queue ({queue.length})
          </button>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-all hover:opacity-80"
            style={{ color: showAdd ? accent : T.textMuted }}
          >
            <Plus size={12} /> Add Track
          </button>
        </div>

        {/* Add Track form */}
        {showAdd && (
          <div className="px-4 pb-3 space-y-2">
            <input
              id="music-file"
              name="musicFile"
              type="file"
              accept="audio/*"
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
              style={{
                backgroundColor: T.boxBg,
                border: `1px solid ${accent}40`,
                color: accent,
              }}
            >
              <Upload size={12} />
              {uploading ? "Uploading..." : "Upload MP3"}
            </button>
            <div
              className="text-[9px] text-center"
              style={{ color: T.textMuted }}
            >
              Or paste an audio URL below
            </div>
            <input
              id="music-url"
              name="musicUrl"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="Audio URL or YouTube link"
              className="w-full text-xs px-3 py-1.5 rounded-lg outline-none"
              style={{
                backgroundColor: T.bgColor + "80",
                border: `1px solid ${T.borderColor}30`,
                color: T.textColor,
              }}
            />
            <div className="flex gap-2">
              <input
                id="music-title"
                name="musicTitle"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="Title"
                className="flex-1 text-xs px-3 py-1.5 rounded-lg outline-none"
                style={{
                  backgroundColor: T.bgColor + "80",
                  border: `1px solid ${T.borderColor}30`,
                  color: T.textColor,
                }}
              />
              <input
                id="music-artist"
                name="musicArtist"
                value={addArtist}
                onChange={(e) => setAddArtist(e.target.value)}
                placeholder="Artist"
                className="flex-1 text-xs px-3 py-1.5 rounded-lg outline-none"
                style={{
                  backgroundColor: T.bgColor + "80",
                  border: `1px solid ${T.borderColor}30`,
                  color: T.textColor,
                }}
              />
            </div>
            <button
              onClick={addCustomTrack}
              disabled={!addUrl.trim()}
              className="w-full py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
              style={{ backgroundColor: accent, color: "#000" }}
            >
              Add to Queue
            </button>
          </div>
        )}

        {/* Queue list */}
        {showQueue && (
          <div className="max-h-60 overflow-y-auto px-2 pb-3 space-y-0.5">
            {queue.map((t, i) => (
              <div
                key={t.id + i}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg group transition-all"
                style={{
                  backgroundColor:
                    i === currentIdx ? `${accent}12` : "transparent",
                  border: `1px solid ${i === currentIdx ? accent + "25" : "transparent"}`,
                }}
              >
                <span
                  className="text-[9px] w-4 text-right shrink-0"
                  style={{ color: T.textMuted }}
                >
                  {i + 1}
                </span>
                <button
                  onClick={() => {
                    setCurrentIdx(i);
                    setPlaying(true);
                  }}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <CoverArt track={t} size={24} accent={accent} />
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[11px] font-bold truncate"
                      style={{ color: i === currentIdx ? accent : T.textColor }}
                    >
                      {t.title}
                    </div>
                    <div
                      className="text-[9px] truncate"
                      style={{ color: T.textMuted }}
                    >
                      {t.artist}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => moveInQueue(i, -1)}
                    className="p-0.5 rounded hover:bg-white/10"
                    style={{ color: T.textMuted }}
                    title="Move up"
                  >
                    <ChevronUp size={11} />
                  </button>
                  <button
                    onClick={() => moveInQueue(i, 1)}
                    className="p-0.5 rounded hover:bg-white/10"
                    style={{ color: T.textMuted }}
                    title="Move down"
                  >
                    <ChevronDown size={11} />
                  </button>
                  <button
                    onClick={() => removeFromQueue(i)}
                    className="p-0.5 rounded hover:bg-white/10"
                    style={{ color: T.textMuted }}
                    title="Remove"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
