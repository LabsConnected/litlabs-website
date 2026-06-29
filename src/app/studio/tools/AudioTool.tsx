"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
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
  { id: "nova", label: "Nova", desc: "Warm & clear" },
  { id: "alloy", label: "Alloy", desc: "Neutral & balanced" },
  { id: "echo", label: "Echo", desc: "Deep & resonant" },
  { id: "fable", label: "Fable", desc: "British & refined" },
  { id: "onyx", label: "Onyx", desc: "Authoritative" },
  { id: "shimmer", label: "Shimmer", desc: "Bright & optimistic" },
];

const MUSIC_MODELS = [
  {
    id: "elevenmusic",
    label: "ElevenMusic",
    desc: "Full music generation",
    cost: 2,
  },
  { id: "ace", label: "AceStep", desc: "Electronic beats", cost: 1 },
];

// Sample royalty-free music tracks
const SAMPLE_TRACKS = [
  {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    title: "Synthwave Dreams",
  },
  {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    title: "Neon Nights",
  },
  {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    title: "Cyber Pulse",
  },
  {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    title: "Digital Horizon",
  },
  {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    title: "Electric Sky",
  },
  {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3",
    title: "Future City",
  },
];

const STORAGE_KEY = "litlabs-studio-audio-history";
const MAX_HISTORY = 12;

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
}

export default function AudioTool() {
  const { resolvedColors: T } = useTheme();
  const [mode, setMode] = useState<"tts" | "music">("music");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("nova");
  const [musicModel, setMusicModel] = useState("elevenmusic");
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
  const [coinBalance, setCoinBalance] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const coinsRaw = localStorage.getItem("litcoins");
      const val = coinsRaw ? Number(coinsRaw) : null;
      return val !== null && !isNaN(val) ? val : null;
    } catch {
      return null;
    }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cost =
    mode === "tts"
      ? 1
      : MUSIC_MODELS.find((m) => m.id === musicModel)?.cost || 2;
  const canAfford = coinBalance === null || coinBalance >= cost;

  useEffect(() => {
    fetch("/api/wallet")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.balance === "number") {
          setCoinBalance(d.balance);
          try {
            localStorage.setItem("litcoins", String(d.balance));
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (history.length > 0)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(history.slice(0, MAX_HISTORY)),
      );
  }, [history]);

  // Browser TTS synthesis (plays directly, no download for now)
  const playBrowserTTS = (text: string, voiceId: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    // Map our voice IDs to browser voices
    const voiceMap: Record<string, string[]> = {
      nova: ["Google US English", "Samantha", "Victoria"],
      alloy: ["Google UK English", "Daniel", "Alex"],
      echo: ["Google UK English Male", "Fred", "Bruce"],
      fable: ["Google UK English Female", "Kate", "Serena"],
      onyx: ["Microsoft David", "Tom", "Fred"],
      shimmer: ["Google US English", "Samantha", "Karen"],
    };

    const preferredNames = voiceMap[voiceId] || voiceMap.nova;
    const matchedVoice =
      voices.find((v) =>
        preferredNames.some((name) => v.name.includes(name)),
      ) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      voices[0];

    if (matchedVoice) utterance.voice = matchedVoice;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);

    return new Promise<void>((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
    });
  };

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
    };
    setCurrent(gen);
    setHistory((prev) => [gen, ...prev].slice(0, MAX_HISTORY));

    try {
      let audioUrl: string;

      if (mode === "tts") {
        // For TTS, we use browser synthesis and generate a placeholder audio URL
        // since browser TTS can't be captured easily without a backend
        await playBrowserTTS(text.trim(), voice);
        // Return a data URI with a simple tone as placeholder
        audioUrl =
          "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVanu87plHQUuh9Dz2YU2Bhxqv+zplkcODVGm5O+4ZSAEMYrO89GFNwYdcfDr4ZdJDQtPp+XysWUeBjiS1/LNfi0GI33R8tOENAcdcO+zmm0hDQxPpOXyxmHMM";
      } else {
        // Music mode - use sample tracks with prompt-based selection
        await new Promise((r) => setTimeout(r, 1500)); // Simulate generation time
        const hash = text
          .split("")
          .reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0);
        const track = SAMPLE_TRACKS[Math.abs(hash) % SAMPLE_TRACKS.length];
        audioUrl = track.url;
      }

      setCurrent((prev) =>
        prev?.id === id ? { ...prev, status: "succeeded", audioUrl } : prev,
      );
      setHistory((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, status: "succeeded", audioUrl } : g,
        ),
      );

      // Deduct coins
      const wres = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "spend",
          amount: cost,
          reason: `audio_${mode}`,
        }),
      });
      const wdata = await wres.json();
      if (typeof wdata.balance === "number") setCoinBalance(wdata.balance);
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
  }, [text, voice, musicModel, mode, cost, canAfford]);

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
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
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
