"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useWallet } from "@/context/WalletContext";
import {
  Mic,
  Wand2,
  Download,
  AlertTriangle,
  Loader2,
  History,
  Sparkles,
  Play,
  Pause,
  Volume2,
  RotateCcw,
  Music,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { apiFetch, type ApiJson } from "@/lib/api-response";

/* ─── Types ──────────────────────────────────────────────────────────── */

type AudioMode = "voiceover" | "speech";

type GenStatus = "idle" | "generating" | "ready" | "failed";

interface AudioGen {
  id: string;
  text: string;
  voice: string;
  delivery: string;
  pacing: string;
  mode: AudioMode;
  status: GenStatus;
  audioUrl?: string;
  error?: string;
  createdAt: number;
  cost: number;
}

/* ─── Constants ──────────────────────────────────────────────────────── */

const VOICES = [
  { id: "Kore", label: "Kore", desc: "Warm & clear", bestFor: "Narration, creator content" },
  { id: "Fenrir", label: "Fenrir", desc: "Neutral & balanced", bestFor: "General purpose, tutorials" },
  { id: "Leda", label: "Leda", desc: "Deep & resonant", bestFor: "Dramatic reads, trailers" },
  { id: "Orus", label: "Orus", desc: "British & refined", bestFor: "Documentary, professional" },
  { id: "Zeph", label: "Zeph", desc: "Authoritative", bestFor: "Announcements, ads" },
];

const DELIVERY_OPTIONS = ["Natural", "Friendly", "Professional", "Energetic", "Calm", "Cinematic", "Serious", "Storytelling"];
const PACING_OPTIONS = ["Slow", "Normal", "Fast"];

const COST = 2;
const STORAGE_KEY = "litlabs-studio-audio-history";
const MAX_HISTORY = 8;

/* ─── Helpers ────────────────────────────────────────────────────────── */

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] || "audio/wav";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function getExtension(mime: string): string {
  if (mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  return "mp3";
}

function composeDirection(delivery: string, pacing: string, direction: string): string {
  const parts: string[] = [];
  if (delivery && delivery !== "Natural") parts.push(`${delivery.toLowerCase()} delivery`);
  if (pacing && pacing !== "Normal") parts.push(`${pacing.toLowerCase()} pacing`);
  if (direction.trim()) parts.push(direction.trim());
  return parts.join(", ");
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ─── Entrance animation ─────────────────────────────────────────────── */

function Entrance({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Chip selector ──────────────────────────────────────────────────── */

function ChipRow({
  label,
  options,
  selected,
  onSelect,
  accentColor,
}: {
  label: string;
  options: string[];
  selected: string;
  onSelect: (val: string) => void;
  accentColor: string;
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/40">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isSelected = selected === opt;
          return (
            <button
              key={opt}
              onClick={() => onSelect(opt)}
              className="rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all hover:scale-[1.04] active:scale-95"
              style={{
                borderColor: isSelected ? `${accentColor}80` : "rgba(255,255,255,0.08)",
                background: isSelected ? `${accentColor}18` : "rgba(255,255,255,0.03)",
                color: isSelected ? accentColor : "rgba(255,255,255,0.55)",
                minHeight: 32,
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────── */

export default function AudioTool() {
  const [mode, setMode] = useState<AudioMode>("voiceover");
  const [text, setText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [directedText, setDirectedText] = useState<string | null>(null);
  const [showDirected, setShowDirected] = useState(false);
  const [isDirecting, setIsDirecting] = useState(false);

  const [voice, setVoice] = useState("Kore");
  const [delivery, setDelivery] = useState("Natural");
  const [pacing, setPacing] = useState("Normal");
  const [direction, setDirection] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<AudioGen | null>(null);

  const [history, setHistory] = useState<AudioGen[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as AudioGen[];
      // Keep durable URLs (http/https) in persisted history — they survive
      // reloads and are lightweight. Strip base64 data URLs (too large):
      // non-http audioUrl: undefined (never persist base64 audio data).
      return parsed.map((g) => ({
        ...g,
        audioUrl: g.audioUrl?.startsWith("http") ? g.audioUrl : undefined,
      }));
    } catch {
      return [];
    }
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const { balance: coinBalance, refresh: refreshWallet } = useWallet();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const canAfford = coinBalance === null || coinBalance >= COST;

  useEffect(() => { refreshWallet(); }, [refreshWallet]);

  // Persist lightweight metadata — keep durable URLs (http), strip base64.
  // non-http audioUrl: undefined (never persist base64 audio data).
  useEffect(() => {
    const lightweight = history.slice(0, MAX_HISTORY).map((g) => ({
      ...g,
      // Only persist durable URLs; base64 data URLs are too large for localStorage
      audioUrl: g.audioUrl?.startsWith("http") ? g.audioUrl : undefined,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweight));
  }, [history]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  /* ─── Audio playback ──────────────────────────────────────────────── */

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const playAudio = useCallback((url: string) => {
    // Stop any existing playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }

    // Convert data: URL to blob URL for reliable playback
    let playUrl = url;
    if (url.startsWith("data:")) {
      const blob = dataUrlToBlob(url);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      playUrl = URL.createObjectURL(blob);
      objectUrlRef.current = playUrl;
    }

    const audio = new Audio(playUrl);
    audio.volume = volume;
    audioRef.current = audio;

    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    audio.onended = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.onerror = () => { setIsPlaying(false); setError("Playback failed"); };

    audio.play().catch(() => {
      setIsPlaying(false);
      setError("Could not start playback");
    });
    setIsPlaying(true);
  }, [volume]);

  const togglePlay = useCallback(() => {
    if (!current?.audioUrl) return;
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (audioRef.current && audioRef.current.src) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        playAudio(current.audioUrl);
      }
    }
  }, [current, isPlaying, playAudio]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  }, [duration]);

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  /* ─── Download (fixes data: URL bug) ──────────────────────────────── */

  const handleDownload = useCallback((url: string, label: string) => {
    try {
      let downloadUrl = url;
      let revokeAfter = false;

      if (url.startsWith("data:")) {
        // Convert data URL to blob, then to object URL for download
        const blob = dataUrlToBlob(url);
        downloadUrl = URL.createObjectURL(blob);
        revokeAfter = true;
      }

      const ext = url.startsWith("data:")
        ? getExtension(url.match(/data:(.*?);/)?.[1] || "audio/wav")
        : "mp3";

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `litbit-${label}-${Date.now()}.${ext}`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (revokeAfter) {
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    } catch {
      setError("Download failed. Please try again.");
    }
  }, []);

  /* ─── Direct with LiTT ────────────────────────────────────────────── */

  const handleDirect = useCallback(async () => {
    if (!text.trim()) return;
    setIsDirecting(true);
    setOriginalText(text.trim());
    try {
      // Use the existing suggest-video-ideas endpoint as a general LLM endpoint
      // In production this would be a dedicated /api/media/direct-audio route
      const data = await apiFetch<ApiJson>("/api/media/suggest-video-ideas", {
        method: "POST",
        body: JSON.stringify({ prompt: text.trim(), mode: "direct-audio", delivery, pacing }),
      });
      const directed = (data.enhancedPrompt as string) || (data.directedText as string) || null;
      if (directed) {
        setDirectedText(directed);
        setShowDirected(true);
      } else {
        // Fallback: local composition
        const local = `${text.trim()}\n\n[Delivery: ${delivery}, ${pacing} pacing]`;
        setDirectedText(local);
        setShowDirected(true);
      }
    } catch {
      // Fallback: local composition
      const local = `${text.trim()}\n\n[Delivery: ${delivery}, ${pacing} pacing]`;
      setDirectedText(local);
      setShowDirected(true);
    } finally {
      setIsDirecting(false);
    }
  }, [text, delivery, pacing]);

  /* ─── Generate ────────────────────────────────────────────────────── */

  const finalText = useMemo(() => {
    return showDirected && directedText ? directedText : text.trim();
  }, [text, directedText, showDirected]);

  const styleDirection = useMemo(() => composeDirection(delivery, pacing, direction), [delivery, pacing, direction]);

  const handleGenerate = useCallback(async () => {
    if (!finalText || finalText.length < 3) {
      setError("Script must be at least 3 characters.");
      return;
    }
    if (!canAfford) {
      setError(`Need ${COST} LiTTBits.`);
      return;
    }
    setError(null);
    setIsGenerating(true);
    setGenStatus("generating");
    stopPlayback();

    const id = `aud_${Date.now()}`;
    const gen: AudioGen = {
      id, text: finalText, voice, delivery, pacing, mode,
      status: "generating", createdAt: Date.now(), cost: COST,
    };
    setCurrent(gen);
    setHistory((prev) => [gen, ...prev].slice(0, MAX_HISTORY));

    try {
      const data = await apiFetch<ApiJson>("/api/media/generate-audio", {
        method: "POST",
        body: JSON.stringify({ prompt: finalText, voice, styleDirection }),
      });
      const audioBase64 = data.audioBase64 as string | undefined;
      const durableAudioUrl = data.audioUrl as string | undefined;
      if (!audioBase64 && !durableAudioUrl) throw new Error("No audio returned from generation.");

      // Prefer the durable URL for playback — it survives reloads and
      // is registered in the Asset Lake. Fall back to base64 for
      // immediate playback if persistence failed.
      const playbackUrl = durableAudioUrl || audioBase64!;

      setGenStatus("ready");
      setCurrent((prev) => prev?.id === id ? { ...prev, status: "ready", audioUrl: playbackUrl } : prev);
      setHistory((prev) => prev.map((g) => g.id === id ? { ...g, status: "ready", audioUrl: playbackUrl } : g));
      refreshWallet().catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Audio generation failed";
      setError(msg);
      setGenStatus("failed");
      refreshWallet().catch(() => {});
      setCurrent((prev) => prev?.id === id ? { ...prev, status: "failed", error: msg } : prev);
      setHistory((prev) => prev.map((g) => g.id === id ? { ...g, status: "failed", error: msg } : g));
    } finally {
      setIsGenerating(false);
    }
  }, [finalText, voice, styleDirection, mode, delivery, pacing, canAfford, refreshWallet, stopPlayback]);

  /* ─── Remix ───────────────────────────────────────────────────────── */

  const handleRemix = () => {
    if (!current) return;
    setText(current.text);
    setVoice(current.voice);
    setDelivery(current.delivery);
    setPacing(current.pacing);
    setGenStatus("idle");
    setCurrent(null);
    stopPlayback();
  };

  const handleClear = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  /* ─── Estimated duration ──────────────────────────────────────────── */

  const estimatedDuration = useMemo(() => {
    const words = finalText.split(/\s+/).filter(Boolean).length;
    const wpm = pacing === "Slow" ? 120 : pacing === "Fast" ? 180 : 150;
    return Math.ceil((words / wpm) * 60);
  }, [finalText, pacing]);

  /* ─── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="w-full space-y-4 p-4" style={{ background: "#050508", minHeight: "100%" }}>
      {/* Header */}
      <Entrance delay={0}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.25)" }}>
              <Mic size={18} style={{ color: "#22D3EE" }} />
            </div>
            <div>
              <div className="text-sm font-black tracking-tight text-white">LiTT Audio Lab</div>
              <div className="text-[10px] text-white/40">Voice, speech and sound production</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border px-2.5 py-1 text-[10px] font-black" style={{ borderColor: "rgba(114,242,56,0.3)", background: "rgba(114,242,56,0.08)", color: "#72F238" }}>
              {coinBalance ?? "—"} BITS
            </span>
            <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black" style={{ borderColor: "rgba(255,255,255,0.08)", color: genStatus === "generating" ? "#F97316" : "#72F238" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: genStatus === "generating" ? "#F97316" : "#72F238" }} />
              {genStatus === "generating" ? "RECORDING" : genStatus === "ready" ? "READY" : "READY"}
            </span>
          </div>
        </div>
      </Entrance>

      {/* Mode tabs */}
      <Entrance delay={0.05}>
        <div className="flex gap-2">
          {([
            { id: "voiceover" as const, label: "Voiceover", desc: "Narration & long-form" },
            { id: "speech" as const, label: "Speech", desc: "Short & punchy" },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className="flex flex-col items-start rounded-xl border px-4 py-2.5 transition-all hover:scale-[1.02] active:scale-95"
              style={{
                borderColor: mode === tab.id ? "rgba(34,211,238,0.5)" : "rgba(255,255,255,0.08)",
                background: mode === tab.id ? "rgba(34,211,238,0.10)" : "rgba(255,255,255,0.02)",
              }}
            >
              <span className="text-xs font-black" style={{ color: mode === tab.id ? "#22D3EE" : "rgba(255,255,255,0.6)" }}>{tab.label}</span>
              <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>{tab.desc}</span>
            </button>
          ))}
        </div>
      </Entrance>

      {/* Audio Stage / Player */}
      <Entrance delay={0.1}>
        <div className="relative overflow-hidden rounded-2xl border" style={{ borderColor: "rgba(255,255,255,0.08)", background: "#080710" }}>
          {/* Ambient bloom */}
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(34,211,238,0.06) 0%, transparent 70%)" }} />

          <div className="relative p-6" style={{ minHeight: 160 }}>
            {current?.audioUrl && genStatus === "ready" ? (
              <div className="space-y-4">
                {/* Waveform-like visualization */}
                <div className="flex items-end justify-center gap-0.5 h-16" aria-hidden="true">
                  {Array.from({ length: 48 }).map((_, i) => {
                    const active = isPlaying && (i / 48) * duration <= currentTime;
                    const height = 20 + Math.sin(i * 0.5) * 15 + Math.cos(i * 0.3) * 10 + (i % 7) * 4;
                    return (
                      <div
                        key={i}
                        className="w-1 rounded-full transition-colors duration-150"
                        style={{
                          height: `${Math.max(8, Math.min(64, height))}px`,
                          background: active ? "#22D3EE" : "rgba(255,255,255,0.12)",
                          boxShadow: active ? "0 0 4px rgba(34,211,238,0.4)" : "none",
                        }}
                      />
                    );
                  })}
                </div>

                {/* Progress bar */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-white/40">{formatTime(currentTime)}</span>
                  <div
                    className="relative h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                    onClick={handleSeek}
                    role="slider"
                    aria-label="Seek audio"
                    aria-valuenow={currentTime}
                    aria-valuemax={duration}
                    tabIndex={0}
                  >
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%`, background: "linear-gradient(90deg, #22D3EE, #8B5CF6)" }} />
                  </div>
                  <span className="text-[10px] font-mono text-white/40">{formatTime(duration)}</span>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3">
                  <button onClick={togglePlay} className="flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition hover:scale-105" style={{ borderColor: "rgba(34,211,238,0.3)", background: "rgba(34,211,238,0.08)", color: "#22D3EE", minHeight: 40 }}>
                    {isPlaying ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
                  </button>
                  <button onClick={() => handleDownload(current.audioUrl!, "voice")} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold transition hover:scale-105" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", minHeight: 40 }}>
                    <Download size={12} /> Download
                  </button>
                  <button onClick={handleRemix} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold transition hover:scale-105" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", minHeight: 40 }}>
                    <RotateCcw size={12} /> Remix
                  </button>
                  {/* Volume */}
                  <div className="ml-auto flex items-center gap-2">
                    <Volume2 size={14} className="text-white/30" />
                    <input type="range" min={0} max={1} step={0.05} value={volume} onChange={handleVolume} className="w-20 accent-cyan-400" aria-label="Volume" />
                  </div>
                </div>

                {/* Metadata */}
                <div className="flex items-center gap-3 text-[9px] text-white/30">
                  <span>{voice}</span>
                  <span>{delivery}</span>
                  <span>{pacing}</span>
                  <span>{COST} BITS</span>
                </div>
              </div>
            ) : genStatus === "generating" ? (
              <div className="flex flex-col items-center justify-center gap-4" style={{ minHeight: 120 }}>
                <motion.div className="h-1 w-48 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.8), transparent)" }}
                    animate={{ x: ["-100%", "100%"] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                </motion.div>
                <div className="text-sm font-black uppercase tracking-[.2em] text-white/60">Generating your audio</div>
                <div className="text-[10px] text-white/30">{voice} · {delivery}</div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: 120 }}>
                <Mic size={36} className="opacity-20" style={{ color: "#22D3EE" }} />
                <p className="text-sm text-white/40">Your audio will appear here</p>
                <p className="text-[10px] text-white/20">{voice} · ~{formatTime(estimatedDuration)} estimated</p>
              </div>
            )}
          </div>
        </div>
      </Entrance>

      {/* Script Editor + Controls */}
      <Entrance delay={0.15}>
        <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.6)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: "#22D3EE" }} />
            <span className="text-[10px] font-black uppercase tracking-[.16em] text-white/50">What should LiTT say?</span>
          </div>

          {showDirected && directedText ? (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <button onClick={() => setShowDirected(false)} className="rounded-full border px-3 py-1 text-[10px] font-bold" style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>Original</button>
                <button onClick={() => setShowDirected(true)} className="rounded-full border px-3 py-1 text-[10px] font-bold" style={{ borderColor: "rgba(34,211,238,0.4)", background: "rgba(34,211,238,0.12)", color: "#22D3EE" }}>Directed</button>
              </div>
              <div className="whitespace-pre-wrap rounded-xl border p-3 text-sm leading-relaxed" style={{ borderColor: "rgba(34,211,238,0.2)", background: "rgba(34,211,238,0.05)", color: "rgba(255,255,255,0.85)" }}>
                {showDirected ? directedText : originalText}
              </div>
              {showDirected && (
                <button onClick={() => { setText(directedText); setShowDirected(false); }} className="text-[10px] font-bold text-white/40 transition hover:text-white/70">
                  Use directed script →
                </button>
              )}
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null); }}
              placeholder="Welcome to LiTTree LabStudios. Today, we're gonna build something incredible..."
              rows={4}
              disabled={isGenerating}
              className="mt-3 w-full resize-none rounded-xl border bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none disabled:opacity-50"
              style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.9)", background: "rgba(255,255,255,0.02)" }}
              aria-label="Script text"
            />
          )}

          <div className="mt-2 flex items-center justify-between text-[10px] text-white/30">
            <span>{text.length} chars · ~{formatTime(estimatedDuration)}</span>
            <span>Markers: [pause] [slow] [emphasis] [excited]</span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleDirect}
              disabled={!text.trim() || isDirecting || isGenerating}
              className="flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-bold transition hover:scale-[1.02] active:scale-95 disabled:opacity-40"
              style={{ borderColor: "rgba(34,211,238,0.3)", background: "rgba(34,211,238,0.08)", color: "#22D3EE", minHeight: 40 }}
            >
              {isDirecting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              Direct with LiTT
            </button>
            <button
              onClick={handleGenerate}
              disabled={!text.trim() || !canAfford || isGenerating}
              className="ml-auto flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-black transition hover:scale-[1.02] active:scale-95 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #22D3EE, #8B5CF6)", color: "#050508", boxShadow: "0 0 24px rgba(34,211,238,0.25)", minHeight: 40 }}
            >
              {isGenerating ? <><Loader2 size={14} className="animate-spin" /> Generating...</> : <><Sparkles size={14} /> Generate Voice · {COST} BITS</>}
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px]" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
              <AlertTriangle size={12} />
              <span>{error}</span>
              {(error.includes("failed") || error.includes("No audio")) && (
                <button onClick={handleGenerate} className="ml-auto rounded-lg px-2 py-0.5 text-[9px] font-bold transition hover:opacity-80" style={{ background: "rgba(239,68,68,0.2)" }}>Retry</button>
              )}
            </div>
          )}
        </div>
      </Entrance>

      {/* Voice + Delivery */}
      <Entrance delay={0.2}>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Voice picker */}
          <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.5)", backdropFilter: "blur(12px)" }}>
            <div className="mb-3 text-[10px] font-black uppercase tracking-[.16em] text-white/50">Voice</div>
            <div className="space-y-2">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVoice(v.id)}
                  disabled={isGenerating}
                  className="w-full rounded-xl border p-3 text-left transition-all hover:scale-[1.01] disabled:opacity-50"
                  style={{
                    borderColor: voice === v.id ? "rgba(34,211,238,0.5)" : "rgba(255,255,255,0.06)",
                    background: voice === v.id ? "rgba(34,211,238,0.10)" : "rgba(255,255,255,0.02)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: voice === v.id ? "#22D3EE" : "rgba(255,255,255,0.2)" }} />
                      <span className="text-sm font-black" style={{ color: voice === v.id ? "#22D3EE" : "rgba(255,255,255,0.8)" }}>{v.label}</span>
                    </div>
                    <span className="text-[9px] text-white/30">{v.desc}</span>
                  </div>
                  <div className="mt-1 ml-4 text-[10px] text-white/30">Best for: {v.bestFor}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Delivery controls */}
          <div className="space-y-4 rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.5)", backdropFilter: "blur(12px)" }}>
            <ChipRow label="Delivery" options={DELIVERY_OPTIONS} selected={delivery} onSelect={setDelivery} accentColor="#8B5CF6" />
            <ChipRow label="Pacing" options={PACING_OPTIONS} selected={pacing} onSelect={setPacing} accentColor="#22D3EE" />

            {/* Direction */}
            <div>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/40">Direction</div>
              <input
                type="text"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                disabled={isGenerating}
                placeholder="Sound like a late-night radio host, confident but relaxed..."
                className="w-full rounded-xl border bg-transparent px-3 py-2 text-xs outline-none disabled:opacity-50"
                style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", background: "rgba(255,255,255,0.02)" }}
                aria-label="Direction notes"
              />
            </div>

            {/* Advanced */}
            <div>
              <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex w-full items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[.16em] text-white/40">Advanced</span>
                <ChevronDown size={14} className="text-white/40 transition-transform" style={{ transform: showAdvanced ? "rotate(180deg)" : "none" }} />
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-[10px]" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                    <span className="text-white/40">Model</span>
                    <span className="font-bold text-white/60">Gemini TTS</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-[10px]" style={{ borderColor: "rgba(34,211,238,0.2)", background: "rgba(34,211,238,0.05)" }}>
                    <span className="text-white/40">Cost</span>
                    <span className="font-black" style={{ color: "#22D3EE" }}>{COST} BITS</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Entrance>

      {/* Music redirect */}
      <Entrance delay={0.25}>
        <div className="flex items-center justify-between rounded-2xl border p-4" style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(139,92,246,0.04)" }}>
          <div className="flex items-center gap-3">
            <Music size={16} style={{ color: "#A970FF" }} />
            <div>
              <div className="text-xs font-bold text-white/70">Need a song or beat?</div>
              <div className="text-[10px] text-white/40">LiTT Music has full music generation</div>
            </div>
          </div>
          <a href="/studio?tool=music" className="flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-bold transition hover:scale-105" style={{ borderColor: "rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)", color: "#A970FF", minHeight: 40 }}>
            Open LiTT Music <ArrowRight size={12} />
          </a>
        </div>
      </Entrance>

      {/* History */}
      <Entrance delay={0.3}>
        <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(10,9,18,0.5)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <History size={11} className="text-white/40" />
              <span className="text-[10px] font-black uppercase tracking-[.16em] text-white/40">Recent Takes</span>
            </div>
            {history.length > 0 && (
              <button onClick={handleClear} className="text-[9px] text-white/30 transition hover:text-white/60">Clear</button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="py-6 text-center text-[11px] text-white/25">No takes yet</div>
          ) : (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
              {history.map((g) => (
                <div
                  key={g.id}
                  className="relative w-36 shrink-0 overflow-hidden rounded-xl border p-3"
                  style={{ borderColor: g.status === "failed" ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}
                >
                  {/* Mini waveform */}
                  <div className="flex items-end gap-0.5 h-6 mb-2">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-0.5 rounded-full"
                        style={{
                          height: `${20 + Math.sin(i * 0.8) * 8 + (i % 5) * 3}px`,
                          background: g.status === "ready" ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.1)",
                        }}
                      />
                    ))}
                  </div>
                  <div className="truncate text-[10px] font-bold text-white/60">{g.voice}</div>
                  <div className="truncate text-[9px] text-white/30">{g.delivery} · {g.pacing}</div>
                  <div className="mt-1 text-[8px] text-white/20">{new Date(g.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
                  {g.status === "failed" && (
                    <div className="mt-1 flex items-center gap-1 text-[8px]" style={{ color: "#ef4444" }}>
                      <AlertTriangle size={8} /> Failed
                    </div>
                  )}
                  {g.status === "ready" && g.audioUrl && (
                    <button
                      onClick={() => { setCurrent(g); setGenStatus("ready"); if (g.audioUrl) playAudio(g.audioUrl); }}
                      className="mt-2 flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-bold transition hover:scale-105"
                      style={{ borderColor: "rgba(34,211,238,0.2)", color: "#22D3EE" }}
                    >
                      <Play size={9} /> Play
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Entrance>
    </div>
  );
}
