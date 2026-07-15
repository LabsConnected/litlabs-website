"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import {
  Mic,
  Music,
  Coins,
  Loader2,
  Play,
  Pause,
  Download,
  AlertCircle,
  Square,
  Volume2,
  VolumeX,
  Trash2,
  X,
} from "lucide-react";

type Tab = "tts" | "music";

interface GeneratedResult {
  id: string;
  url: string;
  type: Tab;
  label: string;
  createdAt: string;
}

interface AudioPlayerState {
  playing: boolean;
  progress: number;
  duration: number;
  muted: boolean;
  volume: number;
}

const COIN_COST: Record<Tab, number> = { tts: 2, music: 20 };

const VOICES = [
  { value: "Kore", label: "Kore", desc: "Firm · Female" },
  { value: "Charon", label: "Charon", desc: "Informational · Male" },
  { value: "Fenrir", label: "Fenrir", desc: "Excitable · Male" },
  { value: "Aoede", label: "Aoede", desc: "Breezy · Female" },
  { value: "Puck", label: "Puck", desc: "Upbeat · Male" },
  { value: "Leda", label: "Leda", desc: "Youthful · Female" },
  { value: "Orus", label: "Orus", desc: "Steady · Male" },
  { value: "Zephyr", label: "Zephyr", desc: "Bright · Female" },
];

function formatTime(s: number) {
  if (!s || isNaN(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function AudioResultPlayer({
  result,
  onDelete,
}: {
  result: GeneratedResult;
  accent?: string;
  onDelete: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<AudioPlayerState>({
    playing: false,
    progress: 0,
    duration: 0,
    muted: false,
    volume: 80,
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = state.volume / 100;
    const onTimeUpdate = () =>
      setState((s) => ({
        ...s,
        progress: audio.currentTime,
        duration: audio.duration || 0,
      }));
    const onEnded = () =>
      setState((s) => ({ ...s, playing: false, progress: 0 }));
    const onLoaded = () =>
      setState((s) => ({ ...s, duration: audio.duration || 0 }));
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoaded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoaded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.url]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state.playing) {
      audio.pause();
      setState((s) => ({ ...s, playing: false }));
    } else {
      audio
        .play()
        .then(() => setState((s) => ({ ...s, playing: true })))
        .catch(() => {});
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setState((s) => ({ ...s, playing: false, progress: 0 }));
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !state.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * state.duration;
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !state.muted;
    setState((s) => ({ ...s, muted: !s.muted }));
  };

  const changeVolume = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const v = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    audio.volume = v / 100;
    setState((s) => ({ ...s, volume: v, muted: false }));
  };

  const isBase64 = result.url.startsWith("data:");
  const downloadHref = result.url;
  const downloadName = `${result.label.replace(/\s+/g, "-").slice(0, 30)}.${result.type === "tts" ? "mp3" : "mp3"}`;
  const typeColor = result.type === "tts" ? "#00f0ff" : "#ff00a0";

  return (
    <div
      className="rounded-xl p-3 space-y-2"
      style={{
        backgroundColor: `${T.bgColor}60`,
        border: `1px solid ${T.borderColor}15`,
      }}
    >
      <audio ref={audioRef} src={result.url} preload="metadata" />

      {/* Header row */}
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${typeColor}15` }}
        >
          {result.type === "tts" ? (
            <Mic size={12} style={{ color: typeColor }} />
          ) : (
            <Music size={12} style={{ color: typeColor }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-xs font-bold truncate"
            style={{ color: T.textColor }}
          >
            {result.label}
          </div>
          <div className="text-[9px]" style={{ color: T.textMuted }}>
            {new Date(result.createdAt).toLocaleTimeString()}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(isBase64 || result.url.startsWith("http")) && (
            <a
              href={downloadHref}
              download={downloadName}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-all"
              style={{ color: T.textMuted }}
              title="Download"
            >
              <Download size={12} />
            </a>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-all"
            style={{ color: T.textMuted }}
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="cursor-pointer" onClick={seek}>
        <div
          className="relative h-1.5 rounded-full"
          style={{ backgroundColor: T.borderColor + "30" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${state.duration ? (state.progress / state.duration) * 100 : 0}%`,
              backgroundColor: typeColor,
            }}
          />
        </div>
        <div
          className="flex justify-between text-[9px] mt-0.5"
          style={{ color: T.textMuted }}
        >
          <span>{formatTime(state.progress)}</span>
          <span>{formatTime(state.duration)}</span>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2">
        <button
          onClick={stop}
          className="p-1 rounded hover:bg-white/10 transition-all"
          style={{ color: T.textMuted }}
          title="Stop"
        >
          <Square size={11} />
        </button>
        <button
          onClick={togglePlay}
          className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-105"
          style={{ backgroundColor: typeColor, color: "#000" }}
        >
          {state.playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          onClick={toggleMute}
          className="p-1 rounded hover:bg-white/10 transition-all"
          style={{ color: T.textMuted }}
        >
          {state.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </button>
        <div className="flex-1 cursor-pointer" onClick={changeVolume}>
          <div
            className="relative h-1 rounded-full"
            style={{ backgroundColor: T.borderColor + "30" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${state.muted ? 0 : state.volume}%`,
                backgroundColor: T.textMuted,
              }}
            />
          </div>
        </div>
        <span
          className="text-[9px] w-7 text-right shrink-0"
          style={{ color: T.textMuted }}
        >
          {state.muted ? 0 : state.volume}%
        </span>
      </div>
    </div>
  );
}

export default function AudioTool() {
  const { resolvedColors: T } = useTheme();
  const { balance } = useWallet();
  const abortRef = useRef<AbortController | null>(null);

  const [tab, setTab] = useState<Tab>("tts");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedResult[]>([]);

  const [ttsText, setTtsText] = useState("");
  const [ttsVoice, setTtsVoice] = useState("Kore");
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicLyrics, setMusicLyrics] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(true);

  const accent = tab === "tts" ? "#00f0ff" : "#ff00a0";

  const handleGenerate = useCallback(async () => {
    setError(null);
    setLoading(true);
    abortRef.current = new AbortController();
    try {
      if (tab === "tts") {
        if (!ttsText.trim()) throw new Error("Enter text to convert.");
        const res = await fetch("/api/media/generate-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: ttsText, voice: ttsVoice }),
          signal: abortRef.current.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "TTS generation failed.");
        const audioUrl = data.audioBase64 as string;
        if (!audioUrl) throw new Error("No audio returned from TTS.");
        setResults((prev) => [
          {
            id: Date.now().toString(),
            url: audioUrl,
            type: "tts",
            label: ttsText.slice(0, 50),
            createdAt: new Date().toISOString(),
          },
          ...prev.slice(0, 9),
        ]);
      } else {
        if (!musicPrompt.trim()) throw new Error("Enter a music prompt.");
        const res = await fetch("/api/music/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: musicPrompt,
            lyrics: musicLyrics || undefined,
            isInstrumental,
            model: "music-2.6-free",
            outputFormat: "url",
          }),
          signal: abortRef.current.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Music generation failed.");
        const audioUrl: string = data.audio?.url ?? data.audio ?? "";
        if (!audioUrl) throw new Error("No audio returned from music gen.");
        setResults((prev) => [
          {
            id: Date.now().toString(),
            url: audioUrl,
            type: "music",
            label: musicPrompt.slice(0, 50),
            createdAt: new Date().toISOString(),
          },
          ...prev.slice(0, 9),
        ]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [tab, ttsText, ttsVoice, musicPrompt, musicLyrics, isInstrumental]);

  const cancelGeneration = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const deleteResult = (id: string) =>
    setResults((prev) => prev.filter((r) => r.id !== id));

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        border: `1px solid ${accent}20`,
        backgroundColor: `${T.boxBg}80`,
      }}
    >
      {/* Tab bar */}
      <div
        className="flex border-b"
        style={{ borderColor: `${T.borderColor}20` }}
      >
        {(["tts", "music"] as Tab[]).map((t) => {
          const a = t === "tts" ? "#00f0ff" : "#ff00a0";
          return (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all"
              style={{
                backgroundColor: tab === t ? `${a}12` : "transparent",
                color: tab === t ? a : T.textMuted,
                borderBottom:
                  tab === t ? `2px solid ${a}` : "2px solid transparent",
              }}
            >
              {t === "tts" ? <Mic size={13} /> : <Music size={13} />}
              {t === "tts" ? "Text-to-Speech" : "Music Gen"}
              <span
                className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black"
                style={{ backgroundColor: `${a}20`, color: a }}
              >
                <Coins size={8} className="inline mr-0.5" />
                {COIN_COST[t]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="p-5 space-y-4">
        {tab === "tts" ? (
          <>
            <div>
              <label
                className="text-[10px] font-bold uppercase tracking-widest mb-1 block"
                style={{ color: T.textMuted }}
              >
                Text
              </label>
              <textarea
                id="tts-text"
                name="ttsText"
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Enter text to convert to speech…"
                className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none transition-all"
                style={{
                  backgroundColor: `${T.bgColor}80`,
                  border: `1px solid ${T.borderColor}30`,
                  color: T.textColor,
                }}
              />
              <div
                className="text-[9px] text-right mt-0.5"
                style={{ color: T.textMuted }}
              >
                {ttsText.length}/500
              </div>
            </div>

            <div>
              <label
                className="text-[10px] font-bold uppercase tracking-widest mb-2 block"
                style={{ color: T.textMuted }}
              >
                Voice
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {VOICES.map((v) => (
                  <button
                    key={v.value}
                    onClick={() => setTtsVoice(v.value)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all"
                    style={{
                      backgroundColor:
                        ttsVoice === v.value ? `${accent}15` : `${T.bgColor}60`,
                      border: `1px solid ${ttsVoice === v.value ? accent + "40" : T.borderColor + "20"}`,
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px]"
                      style={{
                        backgroundColor:
                          ttsVoice === v.value
                            ? accent + "30"
                            : T.borderColor + "20",
                        color: ttsVoice === v.value ? accent : T.textMuted,
                      }}
                    >
                      {v.value[0]}
                    </div>
                    <div>
                      <div
                        className="text-[11px] font-bold"
                        style={{
                          color: ttsVoice === v.value ? accent : T.textColor,
                        }}
                      >
                        {v.label}
                      </div>
                      <div
                        className="text-[9px]"
                        style={{ color: T.textMuted }}
                      >
                        {v.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label
                className="text-[10px] font-bold uppercase tracking-widest mb-1 block"
                style={{ color: T.textMuted }}
              >
                Music Prompt
              </label>
              <textarea
                id="music-prompt"
                name="musicPrompt"
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Describe the music you want to create…"
                className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{
                  backgroundColor: `${T.bgColor}80`,
                  border: `1px solid ${T.borderColor}30`,
                  color: T.textColor,
                }}
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className="relative w-9 h-5 rounded-full transition-all"
                style={{
                  backgroundColor: isInstrumental
                    ? accent
                    : T.borderColor + "40",
                }}
                onClick={() => setIsInstrumental((v) => !v)}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                  style={{ left: isInstrumental ? "calc(100% - 18px)" : "2px" }}
                />
              </div>
              <span
                className="text-xs font-bold"
                style={{ color: T.textMuted }}
              >
                Instrumental only
              </span>
            </label>
            {!isInstrumental && (
              <div>
                <label
                  className="text-[10px] font-bold uppercase tracking-widest mb-1 block"
                  style={{ color: T.textMuted }}
                >
                  Lyrics (optional)
                </label>
                <textarea
                  id="music-lyrics"
                  name="musicLyrics"
                  value={musicLyrics}
                  onChange={(e) => setMusicLyrics(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Add your own lyrics…"
                  className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{
                    backgroundColor: `${T.bgColor}80`,
                    border: `1px solid ${T.borderColor}30`,
                    color: T.textColor,
                  }}
                />
              </div>
            )}
          </>
        )}

        {error && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "#ff000015",
              border: "1px solid #ff000030",
              color: "#ff6666",
            }}
          >
            <AlertCircle size={13} /> {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X size={11} />
            </button>
          </div>
        )}

        <div
          className="flex items-center justify-between text-[10px]"
          style={{ color: T.textMuted }}
        >
          <span className="flex items-center gap-1">
            <Coins size={10} style={{ color: T.accentColor }} />
            <span style={{ color: T.accentColor }} className="font-bold">
              {balance.toLocaleString()}
            </span>{" "}
            coins
          </span>
          {balance < COIN_COST[tab] && (
            <span className="text-yellow-400 font-bold">
              Insufficient coins
            </span>
          )}
        </div>

        {loading ? (
          <button
            onClick={cancelGeneration}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black transition-all"
            style={{
              backgroundColor: "#ff444420",
              color: "#ff6666",
              border: "1px solid #ff444430",
            }}
          >
            <Loader2 size={15} className="animate-spin" /> Generating…{" "}
            <X size={13} className="ml-auto" /> Cancel
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={balance < COIN_COST[tab]}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: accent,
              color: "#000",
              boxShadow: `0 0 20px ${accent}40`,
            }}
          >
            {tab === "tts" ? <Mic size={15} /> : <Music size={15} />}
            Generate · <Coins size={12} />
            {COIN_COST[tab]} coins
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div
          className="border-t px-4 pb-4 pt-3 space-y-2"
          style={{ borderColor: `${T.borderColor}20` }}
        >
          <div className="flex items-center justify-between mb-1">
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: T.textMuted }}
            >
              Recent ({results.length})
            </span>
            <button
              onClick={() => setResults([])}
              className="text-[9px] hover:opacity-70 transition-opacity"
              style={{ color: T.textMuted }}
            >
              Clear all
            </button>
          </div>
          {results.map((r) => (
            <AudioResultPlayer
              key={r.id}
              result={r}
              accent={r.type === "tts" ? "#00f0ff" : "#ff00a0"}
              onDelete={() => deleteResult(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
