"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import {
  Film,
  Wand2,
  Download,
  RefreshCw,
  AlertTriangle,
  Loader2,
  History,
  Clock,
  Sparkles,
} from "lucide-react";

const VIDEO_MODELS = [
  {
    id: "veo",
    label: "Veo",
    provider: "Google",
    desc: "High-quality cinematic",
    cost: 5,
  },
  {
    id: "wan",
    label: "Wan",
    provider: "Alibaba",
    desc: "Fast general purpose",
    cost: 3,
  },
  {
    id: "wan-pro",
    label: "Wan Pro",
    provider: "Alibaba",
    desc: "Enhanced quality",
    cost: 4,
  },
  {
    id: "seedance-pro",
    label: "Seedance Pro",
    provider: "ByteDance",
    desc: "Motion mastery",
    cost: 4,
  },
  {
    id: "ltx-2",
    label: "LTX-2",
    provider: "Lightricks",
    desc: "Realistic scenes",
    cost: 3,
  },
];

const PROMPT_PRESETS = [
  "A cyberpunk street market at night, neon signs flickering, people walking in rain, cinematic slow motion",
  "Space station orbiting a gas giant, ships docking, Earth visible in distance, epic sci-fi",
  "Ancient temple crumbling, dust and debris, dramatic sunlight beams, Indiana Jones style",
  "Underwater coral reef, tropical fish swimming, sunlight filtering through water, serene",
];

const STORAGE_KEY = "litlabs-studio-video-history";
const MAX_HISTORY = 8;

interface VideoGen {
  id: string;
  prompt: string;
  model: string;
  duration: number;
  status: "idle" | "generating" | "succeeded" | "failed";
  videoUrl?: string;
  error?: string;
  createdAt: number;
  cost: number;
}

export default function VideoTool() {
  const { resolvedColors: T } = useTheme();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("veo");
  const [duration, setDuration] = useState(4);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<VideoGen | null>(null);
  const [history, setHistory] = useState<VideoGen[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  // Use WalletContext
  const { balance: coinBalance, refresh: refreshWallet } = useWallet();

  const cost = VIDEO_MODELS.find((m) => m.id === model)?.cost || 5;
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
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError("Prompt must be at least 3 characters.");
      return;
    }
    if (!canAfford) {
      setError(`Need ${cost} LiTBit Coins.`);
      return;
    }
    setError(null);
    setIsGenerating(true);
    const id = `vid_${Date.now()}`;
    const gen: VideoGen = {
      id,
      prompt: prompt.trim(),
      model,
      duration,
      status: "generating",
      createdAt: Date.now(),
      cost,
    };
    setCurrent(gen);
    setHistory((prev) => [gen, ...prev].slice(0, MAX_HISTORY));

    try {
      const res = await fetch("/api/studio/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          duration,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const videoUrl = URL.createObjectURL(blob);
      setCurrent((prev) =>
        prev?.id === id ? { ...prev, status: "succeeded", videoUrl } : prev,
      );
      setHistory((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, status: "succeeded", videoUrl } : g,
        ),
      );
      // Deduct coins via server
      const wres = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "spend",
          amount: cost,
          reason: `video_${model}`,
        }),
      });
      await wres.json();
      refreshWallet().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video generation failed");
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
  }, [prompt, model, duration, cost, canAfford, refreshWallet]);

  const handleDownload = useCallback((url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `litbit-video-${Date.now()}.mp4`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleClear = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="p-4 space-y-4 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film size={14} style={{ color: T.accentColor }} />
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: T.textMuted }}
          >
            Video Generator
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
              Scene Description
            </label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setError(null);
              }}
              aria-label="Video scene description"
              title="Video scene description"
              placeholder="A dramatic sunset over a cyberpunk city..."
              rows={4}
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
              {prompt.length} chars
            </div>
          </div>

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
              {VIDEO_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  disabled={isGenerating}
                  className="w-full p-2.5 text-left text-[11px] rounded border transition-all hover:scale-[1.01] disabled:opacity-50"
                  style={{
                    backgroundColor:
                      model === m.id ? T.accentColor + "20" : T.bgColor,
                    borderColor: model === m.id ? T.accentColor : T.borderColor,
                    color: model === m.id ? T.accentColor : T.textColor,
                  }}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>{m.label}</span>
                    <span className="text-[9px] opacity-60">{m.provider}</span>
                  </div>
                  <div className="text-[9px] opacity-60 mt-0.5">
                    {m.desc} · {m.cost} 🪙
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="block text-[10px] uppercase tracking-widest mb-1.5"
              style={{ color: T.textMuted }}
            >
              Duration
            </label>
            <input
              type="range"
              min={2}
              max={8}
              step={1}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              disabled={isGenerating}
              aria-label="Video duration in seconds"
              title="Video duration in seconds"
              aria-valuemin={2}
              aria-valuemax={8}
              aria-valuenow={duration}
              className="w-full"
            />
            <div
              className="flex items-center justify-between text-[10px] mt-1"
              style={{ color: T.textMuted }}
            >
              <span>
                <Clock size={10} className="inline mr-1" />
                {duration}s
              </span>
              <span>2s — 8s</span>
            </div>
          </div>

          <div
            className="border rounded-lg p-3"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <label
              className="block text-[10px] uppercase tracking-widest mb-1.5"
              style={{ color: T.textMuted }}
            >
              Quick Starters
            </label>
            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
              {PROMPT_PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setPrompt(p);
                    setError(null);
                  }}
                  disabled={isGenerating}
                  className="w-full text-left text-[10px] px-2 py-1 rounded border hover:opacity-80 disabled:opacity-50 line-clamp-2"
                  style={{
                    backgroundColor: T.bgColor,
                    borderColor: T.borderColor,
                    color: T.textColor,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || !canAfford || isGenerating}
            className="w-full py-3 rounded-lg font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 transition-all hover:scale-[1.01]"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`,
              color: T.bgColor,
              boxShadow: `0 0 20px ${T.accentColor}30`,
            }}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Wand2 size={16} /> Generate ({cost} 🪙)
              </>
            )}
          </button>

          {error && (
            <div
              className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border"
              style={{
                borderColor: "#f85149",
                color: "#f85149",
                backgroundColor: "#f8514910",
              }}
            >
              <AlertTriangle size={12} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* RIGHT: Preview + History */}
        <div className="lg:col-span-3 space-y-3">
          <div
            className="border-2 rounded-lg overflow-hidden"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="px-3 py-1.5 border-b flex items-center justify-between"
              style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}
            >
              <span
                className="text-[10px] uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                Preview
              </span>
              {current?.status === "succeeded" && (
                <span className="text-[10px]" style={{ color: "#56d364" }}>
                  ● Ready
                </span>
              )}
              {isGenerating && (
                <span
                  className="text-[10px] flex items-center gap-1"
                  style={{ color: T.accentColor }}
                >
                  <Loader2 size={10} className="animate-spin" /> Working...
                </span>
              )}
            </div>
            <div
              className="aspect-video relative flex items-center justify-center"
              style={{ backgroundColor: T.bgColor }}
            >
              {current?.videoUrl ? (
                <video
                  src={current.videoUrl}
                  controls
                  className="w-full h-full object-cover"
                  style={{ maxHeight: "360px" }}
                />
              ) : isGenerating ? (
                <div className="text-center">
                  <div className="relative w-20 h-20 mx-auto mb-3">
                    <div
                      className="absolute inset-0 rounded-full border-2 animate-ping"
                      style={{ borderColor: T.accentColor, opacity: 0.4 }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">
                      🎬
                    </div>
                  </div>
                  <p className="text-sm opacity-70">Generating video...</p>
                  <p className="text-[10px] opacity-50 mt-1">
                    This can take 30-120 seconds
                  </p>
                </div>
              ) : (
                <div className="text-center px-6">
                  <div className="text-4xl mb-2 opacity-30">🎬</div>
                  <p className="text-sm opacity-60">
                    Your video will appear here
                  </p>
                </div>
              )}
            </div>
            {current?.videoUrl && (
              <div
                className="px-3 py-2 border-t flex items-center gap-2"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: T.bgColor,
                }}
              >
                <button
                  onClick={() => handleDownload(current.videoUrl!)}
                  className="px-2.5 py-1 text-[10px] font-bold rounded border flex items-center gap-1"
                  style={{ borderColor: T.borderColor, color: T.textColor }}
                >
                  <Download size={10} /> Download
                </button>
                <button
                  onClick={handleGenerate}
                  className="px-2.5 py-1 text-[10px] font-bold rounded border flex items-center gap-1"
                  style={{ borderColor: T.borderColor, color: T.textColor }}
                >
                  <RefreshCw size={10} /> Regen
                </button>
              </div>
            )}
          </div>

          <div
            className="border rounded-lg"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <div
              className="px-3 py-2 border-b flex items-center justify-between"
              style={{ borderColor: T.borderColor }}
            >
              <div
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest"
                style={{ color: T.textMuted }}
              >
                <History size={10} /> Recent ({history.length})
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClear}
                  className="text-[9px] opacity-60 hover:opacity-100"
                >
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="p-6 text-center text-xs opacity-50">
                No videos yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 p-2">
                {history.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setCurrent(g)}
                    className="relative aspect-video border rounded overflow-hidden hover:scale-[1.02] transition-transform"
                    style={{
                      borderColor: T.borderColor,
                      backgroundColor: T.bgColor,
                    }}
                  >
                    {g.videoUrl ? (
                      <video
                        src={g.videoUrl}
                        className="w-full h-full object-cover"
                        muted
                      />
                    ) : g.status === "failed" ? (
                      <div className="w-full h-full flex items-center justify-center text-lg">
                        ⚠️
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2
                          size={14}
                          className="animate-spin opacity-50"
                        />
                      </div>
                    )}
                    <div
                      className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[8px] truncate"
                      style={{
                        backgroundColor: "rgba(0,0,0,0.7)",
                        color: "white",
                      }}
                    >
                      {g.model}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
