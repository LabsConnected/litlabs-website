"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import {
  Music,
  Wand2,
  Download,
  AlertTriangle,
  Loader2,
  History,
  Sparkles,
  Play,
  Pause,
  Mic,
  Volume2,
} from "lucide-react";

const VOICES = [
  { id: "Kore", label: "Kore", desc: "Warm & clear" },
  { id: "Fenrir", label: "Fenrir", desc: "Neutral & balanced" },
  { id: "Leda", label: "Leda", desc: "Deep & resonant" },
  { id: "Orus", label: "Orus", desc: "British & refined" },
  { id: "Zeph", label: "Zeph", desc: "Authoritative" },
];

const MUSIC_MODELS = [
  {
    id: "lyria-3-clip-preview",
    label: "Lyria",
    desc: "Full music generation",
    cost: 3,
  },
];

const GENRES = [
  { id: "auto", label: "Auto" },
  { id: "electronic", label: "Electronic" },
  { id: "orchestral", label: "Orchestral" },
  { id: "lo-fi", label: "Lo-fi" },
  { id: "rock", label: "Rock" },
  { id: "hip-hop", label: "Hip-hop" },
  { id: "ambient", label: "Ambient" },
  { id: "jazz", label: "Jazz" },
  { id: "cinematic", label: "Cinematic" },
  { id: "edm", label: "EDM" },
];

const MOODS = [
  { id: "auto", label: "Auto" },
  { id: "happy", label: "Happy" },
  { id: "sad", label: "Sad" },
  { id: "energetic", label: "Energetic" },
  { id: "calm", label: "Calm" },
  { id: "dark", label: "Dark" },
  { id: "epic", label: "Epic" },
];

const INSTRUMENTS = [
  { id: "guitar", label: "Guitar" },
  { id: "piano", label: "Piano" },
  { id: "synth", label: "Synth" },
  { id: "drums", label: "Drums" },
  { id: "strings", label: "Strings" },
  { id: "bass", label: "Bass" },
  { id: "vocals", label: "Vocals" },
  { id: "brass", label: "Brass" },
];

const STORAGE_KEY = "litlabs-studio-audio-history";
const MAX_HISTORY = 12;

function buildMusicPrompt(
  prompt: string,
  genre: string,
  mood: string,
  tempo: number,
  instruments: string[],
  duration: number,
) {
  const parts = [prompt];
  if (genre && genre !== "auto") parts.push(`Genre: ${genre}.`);
  if (mood && mood !== "auto") parts.push(`Mood: ${mood}.`);
  parts.push(`Tempo: ${tempo} BPM.`);
  if (instruments.length > 0)
    parts.push(`Instruments: ${instruments.join(", ")}.`);
  parts.push(`Duration: ${duration} seconds.`);
  return parts.join(" ");
}

interface AudioGen {
  id: string;
  text: string;
  voice?: string;
  model?: string;
  mode: "tts" | "music";
  status: "idle" | "generating" | "succeeded" | "failed";
  audioUrl?: string;
  error?: string;
  createdAt: number;
  cost: number;
  // Music options
  duration?: number;
  genre?: string;
  mood?: string;
  tempo?: number;
  instruments?: string[];
  seed?: number;
  // TTS options
  speed?: number;
  pitch?: number;
}

export default function AudioTool() {
  const { resolvedColors: T } = useTheme();
  const [mode, setMode] = useState<"tts" | "music">("music");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Kore");
  const [musicModel, setMusicModel] = useState("lyria-3-clip-preview");
  const [musicDuration, setMusicDuration] = useState(30);
  const [musicGenre, setMusicGenre] = useState("auto");
  const [musicMood, setMusicMood] = useState("energetic");
  const [musicTempo, setMusicTempo] = useState(120);
  const [musicInstruments, setMusicInstruments] = useState<string[]>([]);
  const [musicSeed, setMusicSeed] = useState("");
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [ttsPitch, setTtsPitch] = useState(1.0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<AudioGen | null>(null);
  const [history, setHistory] = useState<AudioGen[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [playingId, setPlayingId] = useState<string | null>(null);
  // Use WalletContext
  const { balance: coinBalance, refresh: refreshWallet } = useWallet();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cost =
    mode === "tts"
      ? 2
      : MUSIC_MODELS.find((m) => m.id === musicModel)?.cost || 3;
  const canAfford = coinBalance === null || coinBalance >= cost;

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  useEffect(() => {
    if (history.length > 0)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(history.slice(0, MAX_HISTORY)),
      );
  }, [history]);

  const handleGenerate = useCallback(async () => {
    if (!text.trim() || text.trim().length < 3) {
      setError("Text must be at least 3 characters.");
      return;
    }
    if (!canAfford) {
      setError(`Need ${cost} LiTBit Coins.`);
      return;
    }
    setError(null);
    setIsGenerating(true);
    const id = `aud_${Date.now()}`;
    const gen: AudioGen = {
      id,
      text: text.trim(),
      voice: mode === "tts" ? voice : undefined,
      model: mode === "music" ? musicModel : undefined,
      mode,
      status: "generating",
      createdAt: Date.now(),
      cost,
      ...(mode === "music" && {
        duration: musicDuration,
        genre: musicGenre,
        mood: musicMood,
        tempo: musicTempo,
        instruments: musicInstruments,
        seed: musicSeed ? Number(musicSeed) : undefined,
      }),
      ...(mode === "tts" && {
        speed: ttsSpeed,
        pitch: ttsPitch,
      }),
    };
    setCurrent(gen);
    setHistory((prev) => [gen, ...prev].slice(0, MAX_HISTORY));

    try {
      const endpoint =
        mode === "tts"
          ? "/api/media/generate-audio"
          : "/api/media/generate-music";
      let body: Record<string, unknown>;
      if (mode === "tts") {
        body = {
          prompt: text.trim(),
          voice,
          speed: ttsSpeed,
          pitch: ttsPitch,
        };
      } else {
        const musicPrompt = buildMusicPrompt(
          text.trim(),
          musicGenre,
          musicMood,
          musicTempo,
          musicInstruments,
          musicDuration,
        );
        body = {
          prompt: musicPrompt,
          model: musicModel,
          duration: musicDuration,
          genre: musicGenre,
          mood: musicMood,
          tempo: musicTempo,
          instruments: musicInstruments,
        };
        if (musicSeed) body.seed = Number(musicSeed);
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Audio generation failed");
      if (!data.audioBase64) throw new Error("No audio returned");

      setCurrent((prev) =>
        prev?.id === id
          ? { ...prev, status: "succeeded", audioUrl: data.audioBase64 }
          : prev,
      );
      setHistory((prev) =>
        prev.map((g) =>
          g.id === id
            ? { ...g, status: "succeeded", audioUrl: data.audioBase64 }
            : g,
        ),
      );

      if (typeof data.balance === "number") {
        refreshWallet().catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audio generation failed");
      setCurrent((prev) =>
        prev?.id === id
          ? {
              ...prev,
              status: "failed",
              error: err instanceof Error ? err.message : "failed",
            }
          : prev,
      );
      setHistory((prev) =>
        prev.map((g) =>
          g.id === id
            ? {
                ...g,
                status: "failed",
                error: err instanceof Error ? err.message : "failed",
              }
            : g,
        ),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [
    text,
    voice,
    musicModel,
    mode,
    cost,
    canAfford,
    refreshWallet,
    musicDuration,
    musicGenre,
    musicMood,
    musicTempo,
    musicInstruments,
    musicSeed,
    ttsSpeed,
    ttsPitch,
  ]);

  const togglePlay = (id: string, url: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      audioRef.current?.pause();
      const a = new Audio(url);
      a.play().catch(() => {});
      a.onended = () => setPlayingId(null);
      audioRef.current = a;
      setPlayingId(id);
    }
  };

  const handleDownload = (url: string, label: string) => {
    if (url.startsWith("data:")) {
      setError(
        "Browser TTS audio can't be downloaded. Use the play button to listen.",
      );
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `litbit-${label}-${Date.now()}.mp3`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleClear = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="p-4 space-y-4 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={14} style={{ color: T.accentColor }} />
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: T.textMuted }}
          >
            Audio Generator
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border"
          style={{
            borderColor: T.borderColor,
            color: T.accentColor,
            backgroundColor: T.boxBg,
          }}
        >
          <Sparkles size={10} /> {coinBalance ?? "—"} LiTBit
        </div>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-1">
        {[
          { id: "tts" as const, label: "Text to Speech", icon: Mic },
          { id: "music" as const, label: "Music / Sound", icon: Volume2 },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold rounded border transition-all"
            style={{
              backgroundColor: mode === m.id ? T.accentColor + "20" : T.bgColor,
              borderColor: mode === m.id ? T.accentColor : T.borderColor,
              color: mode === m.id ? T.accentColor : T.textColor,
            }}
          >
            <m.icon size={12} />
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-2 space-y-3">
          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="block text-[10px] uppercase tracking-widest mb-1.5"
              style={{ color: T.textMuted }}
            >
              {mode === "tts" ? "Text to Speak" : "Music Prompt"}
            </label>
            <textarea
              id="audio-tool-prompt"
              name="audioToolPrompt"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              aria-label="Audio prompt text"
              title="Audio prompt text"
              placeholder={
                mode === "tts"
                  ? "Hello world, this is a test of text-to-speech..."
                  : "EDM trap beat with heavy bass drops..."
              }
              rows={5}
              disabled={isGenerating}
              className="w-full px-3 py-2 text-sm rounded outline-none resize-none disabled:opacity-50"
              style={{
                backgroundColor: T.bgColor,
                border: `1px solid ${T.borderColor}`,
                color: T.textColor,
              }}
            />
            <div
              className="text-right text-[10px] mt-1"
              style={{ color: T.textMuted }}
            >
              {text.length} chars
            </div>
          </div>

          {mode === "tts" ? (
            <div
              className="border rounded-lg p-3"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <label
                className="block text-[10px] uppercase tracking-widest mb-2"
                style={{ color: T.textMuted }}
              >
                Voice
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoice(v.id)}
                    disabled={isGenerating}
                    className={`flex items-center gap-2 px-2 py-1.5 text-[10px] rounded border transition-all ${voice === v.id ? "border-cyan-400/50 bg-cyan-400/10" : ""}`}
                    style={{
                      borderColor:
                        voice === v.id ? T.accentColor : T.borderColor,
                      color: T.textColor,
                    }}
                  >
                    <span className="font-bold">{v.label}</span>
                    <span className="opacity-60">{v.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="border rounded-lg p-3"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <label
                className="block text-[10px] uppercase tracking-widest mb-2"
                style={{ color: T.textMuted }}
              >
                Model
              </label>
              <div className="space-y-1.5">
                {MUSIC_MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMusicModel(m.id)}
                    disabled={isGenerating}
                    className="w-full flex items-center justify-between px-2 py-2 text-[10px] rounded border transition-all"
                    style={{
                      borderColor:
                        musicModel === m.id ? T.accentColor : T.borderColor,
                      backgroundColor:
                        musicModel === m.id
                          ? T.accentColor + "10"
                          : "transparent",
                      color: T.textColor,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{m.label}</span>
                      <span className="opacity-60">{m.desc}</span>
                    </div>
                    <span
                      className="px-1.5 py-0.5 rounded border text-[9px]"
                      style={{ borderColor: T.borderColor }}
                    >
                      {m.cost} 🪙
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "tts" && (
            <div
              className="border rounded-lg p-3 space-y-3"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <label
                className="block text-[10px] uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                Speech Settings
              </label>

              <div>
                <div
                  className="flex items-center justify-between text-[10px] mb-1"
                  style={{ color: T.textMuted }}
                >
                  <span>Speed</span>
                  <span>{ttsSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(Number(e.target.value))}
                  disabled={isGenerating}
                  className="w-full"
                />
              </div>

              <div>
                <div
                  className="flex items-center justify-between text-[10px] mb-1"
                  style={{ color: T.textMuted }}
                >
                  <span>Pitch</span>
                  <span>{ttsPitch.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={ttsPitch}
                  onChange={(e) => setTtsPitch(Number(e.target.value))}
                  disabled={isGenerating}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {mode === "music" && (
            <div
              className="border rounded-lg p-3 space-y-3"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <label
                className="block text-[10px] uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                Music Options
              </label>

              <div>
                <div
                  className="flex items-center justify-between text-[10px] mb-1"
                  style={{ color: T.textMuted }}
                >
                  <span>Duration</span>
                  <span>{musicDuration}s</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={180}
                  step={1}
                  value={musicDuration}
                  onChange={(e) => setMusicDuration(Number(e.target.value))}
                  disabled={isGenerating}
                  className="w-full"
                />
              </div>

              <div>
                <div
                  className="text-[10px] mb-1"
                  style={{ color: T.textMuted }}
                >
                  Genre
                </div>
                <select
                  value={musicGenre}
                  onChange={(e) => setMusicGenre(e.target.value)}
                  disabled={isGenerating}
                  className="w-full text-[10px] rounded px-2 py-1.5 outline-none"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}`,
                    color: T.textColor,
                  }}
                >
                  {GENRES.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div
                  className="text-[10px] mb-1"
                  style={{ color: T.textMuted }}
                >
                  Mood
                </div>
                <select
                  value={musicMood}
                  onChange={(e) => setMusicMood(e.target.value)}
                  disabled={isGenerating}
                  className="w-full text-[10px] rounded px-2 py-1.5 outline-none"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}`,
                    color: T.textColor,
                  }}
                >
                  {MOODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div
                  className="flex items-center justify-between text-[10px] mb-1"
                  style={{ color: T.textMuted }}
                >
                  <span>Tempo</span>
                  <span>{musicTempo} BPM</span>
                </div>
                <input
                  type="range"
                  min={60}
                  max={180}
                  step={1}
                  value={musicTempo}
                  onChange={(e) => setMusicTempo(Number(e.target.value))}
                  disabled={isGenerating}
                  className="w-full"
                />
              </div>

              <div>
                <div
                  className="text-[10px] mb-1.5"
                  style={{ color: T.textMuted }}
                >
                  Instruments
                </div>
                <div className="flex flex-wrap gap-1">
                  {INSTRUMENTS.map((inst) => {
                    const selected = musicInstruments.includes(inst.id);
                    return (
                      <button
                        key={inst.id}
                        onClick={() => {
                          setMusicInstruments((prev) =>
                            selected
                              ? prev.filter((i) => i !== inst.id)
                              : [...prev, inst.id],
                          );
                        }}
                        disabled={isGenerating}
                        className="px-2 py-1 rounded border text-[9px] transition-all"
                        style={{
                          borderColor: selected ? T.accentColor : T.borderColor,
                          backgroundColor: selected
                            ? T.accentColor + "15"
                            : "transparent",
                          color: T.textColor,
                        }}
                      >
                        {inst.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div
                  className="text-[10px] mb-1"
                  style={{ color: T.textMuted }}
                >
                  Seed
                </div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={musicSeed}
                  onChange={(e) => setMusicSeed(e.target.value)}
                  placeholder="Random"
                  disabled={isGenerating}
                  className="w-full text-[10px] rounded px-2 py-1.5 outline-none"
                  style={{
                    backgroundColor: T.bgColor,
                    border: `1px solid ${T.borderColor}`,
                    color: T.textColor,
                  }}
                />
              </div>
            </div>
          )}

          {error && (
            <div
              className="flex items-center gap-2 p-2 rounded border text-[11px]"
              style={{
                borderColor: "#ef4444",
                color: "#ef4444",
                backgroundColor: "rgba(239,68,68,0.1)",
              }}
            >
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={
              !text.trim() ||
              text.trim().length < 3 ||
              !canAfford ||
              isGenerating
            }
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded font-bold border transition-all disabled:opacity-40"
            style={{
              borderColor: T.accentColor,
              color: T.accentColor,
              backgroundColor: T.accentColor + "10",
            }}
          >
            {isGenerating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wand2 size={14} />
            )}
            Generate ({cost} 🪙)
          </button>

          {mode === "tts" && (
            <div
              className="text-[10px] p-2 rounded border"
              style={{ borderColor: T.borderColor, color: T.textMuted }}
            >
              💡 Browser TTS plays directly. Audio file downloads coming soon
              with backend generation.
            </div>
          )}
        </div>

        {/* RIGHT: Output + History */}
        <div className="lg:col-span-3 space-y-3">
          {/* Current Generation */}
          {current && (
            <div
              className="border rounded-lg p-4"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-[10px] uppercase tracking-widest"
                  style={{ color: T.textMuted }}
                >
                  {current.status === "generating"
                    ? "Generating..."
                    : current.status === "succeeded"
                      ? "Ready"
                      : "Failed"}
                </span>
                <span className="text-[10px] opacity-60">
                  {current.mode === "tts" ? "TTS" : "Music"}
                </span>
              </div>

              {current.status === "generating" ? (
                <div className="flex items-center gap-3 py-6">
                  <Loader2
                    size={18}
                    className="animate-spin"
                    style={{ color: T.accentColor }}
                  />
                  <span className="text-sm" style={{ color: T.textMuted }}>
                    Creating audio...
                  </span>
                </div>
              ) : current.status === "succeeded" && current.audioUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => togglePlay(current.id, current.audioUrl!)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-bold hover:opacity-80"
                      style={{
                        borderColor: T.accentColor,
                        color: T.accentColor,
                      }}
                    >
                      {playingId === current.id ? (
                        <>
                          <Pause size={12} /> Pause
                        </>
                      ) : (
                        <>
                          <Play size={12} /> Play
                        </>
                      )}
                    </button>
                    <button
                      onClick={() =>
                        handleDownload(current.audioUrl!, current.mode)
                      }
                      className="flex items-center gap-2 px-3 py-1.5 rounded border text-xs hover:opacity-80"
                      style={{ borderColor: T.borderColor, color: T.textMuted }}
                    >
                      <Download size={12} /> Download
                    </button>
                  </div>
                  {current.mode === "music" && (
                    <div className="text-xs" style={{ color: T.textMuted }}>
                      🎵 Sample track generated based on your prompt. Full AI
                      music generation coming soon.
                    </div>
                  )}
                </div>
              ) : current.status === "failed" ? (
                <div className="text-sm" style={{ color: "#ef4444" }}>
                  {current.error || "Failed"}
                </div>
              ) : null}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div
              className="border rounded-lg p-3"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-[10px] uppercase tracking-widest flex items-center gap-1.5"
                  style={{ color: T.textMuted }}
                >
                  <History size={12} /> Recent ({history.length})
                </span>
                <button
                  onClick={handleClear}
                  className="text-[10px] hover:opacity-70"
                  style={{ color: T.textMuted }}
                >
                  Clear
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {history.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between p-2 rounded border"
                    style={{ borderColor: T.borderColor }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs truncate">{g.text}</div>
                      <div className="text-[10px] opacity-50 flex items-center gap-2">
                        <span>{g.mode === "tts" ? "TTS" : "Music"}</span>
                        <span>•</span>
                        <span>{g.cost} 🪙</span>
                        {g.status === "failed" && (
                          <span style={{ color: "#ef4444" }}>Failed</span>
                        )}
                      </div>
                    </div>
                    {g.audioUrl && g.status === "succeeded" && (
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => togglePlay(g.id, g.audioUrl!)}
                          className="p-1.5 rounded hover:opacity-80"
                          style={{ color: T.accentColor }}
                          aria-label={
                            playingId === g.id ? "Pause audio" : "Play audio"
                          }
                        >
                          {playingId === g.id ? (
                            <Pause size={14} />
                          ) : (
                            <Play size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => handleDownload(g.audioUrl!, g.mode)}
                          className="p-1.5 rounded hover:opacity-80"
                          style={{ color: T.textMuted }}
                          aria-label="Download audio"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!current && history.length === 0 && (
            <div
              className="border rounded-lg p-6 text-center"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <Music size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm" style={{ color: T.textMuted }}>
                Your generated audio will appear here
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
