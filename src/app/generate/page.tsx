"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";
import { useAuth, RedirectToSignIn } from "@clerk/nextjs";
import {
  Sparkles, ImageIcon, Wand2, Save, Download, RefreshCw,
  Zap, Coins, AlertTriangle, CheckCircle2, Loader2, X, History
} from "lucide-react";
import { MediaProviderId } from "@/lib/media";

const PROMPT_PRESETS = [
  "A neon-lit cyberpunk city at midnight, rain-slicked streets reflecting holographic billboards, flying cars streaking through fog",
  "Ethereal floating islands with waterfalls cascading into the void, golden hour, Studio Ghibli inspired",
  "Ancient temple ruins reclaimed by bioluminescent jungle, fireflies, mist, mystical atmosphere",
  "Crystal cavern with underground lake, light refracting through quartz, peaceful and majestic",
  "A lone astronaut standing on Mars, Earth rising in the distance, ultra-realistic, cinematic lighting",
  "Massive space station orbiting a purple gas giant, fleets of ships, epic scale, sci-fi concept art",
  "Abandoned arcade with broken neon signs, dust motes in volumetric light, retro 80s aesthetic",
  "Underwater coral city with merfolk and bio-luminescent architecture, dreamlike and serene",
];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type GenerationStatus = "idle" | "submitting" | "polling" | "succeeded" | "failed" | "saving";

type Generation = {
  id: string;
  prompt: string;
  negativePrompt: string;
  provider: MediaProviderId;
  fileUrl?: string;
  thumbUrl?: string;
  status: GenerationStatus;
  error?: string;
  createdAt: number;
  cost: number;
};

const STORAGE_KEY = "litlabs-generate-history";
const MAX_HISTORY = 12;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function GeneratePage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { resolvedColors: T } = useTheme();

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [providerId, setProviderId] = useState<MediaProviderId>("pollinations");
  const [seed, setSeed] = useState<number>(0);

  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(true);

  // Persist history to localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (history.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    }
  }, [history]);

  // Load CRT preference
  useEffect(() => {
    const val = localStorage.getItem("crt_global_scanlines");
    if (val !== null) setCrtEnabled(val === "true");
  }, []);

  // Fetch coin balance on mount
  useEffect(() => {
    if (!isSignedIn) return;
    fetch("/api/wallet")
      .then(r => r.json())
      .then(d => {
        if (typeof d.balance === "number") setCoinBalance(d.balance);
      })
      .catch(() => { /* silent */ });
  }, [isSignedIn]);

  const providerCost = providerId === "pollinations" ? 0 : providerId === "together" ? 2 : providerId === "fal" ? 3 : 0;
  const canAfford = coinBalance === null || coinBalance >= providerCost;
  const promptValid = prompt.trim().length >= 3;

  /* ------------------------- Generate handler ---------------------- */
  const handleGenerate = useCallback(async () => {
    if (!promptValid) {
      setError("Prompt must be at least 3 characters.");
      return;
    }
    if (!canAfford) {
      setError(`Not enough LiTBit Coins. Need ${providerCost}, have ${coinBalance}.`);
      return;
    }

    setError(null);
    setStatus("submitting");

    const localId = `gen_${Date.now()}`;
    const newGen: Generation = {
      id: localId,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim(),
      provider: providerId,
      status: "submitting",
      createdAt: Date.now(),
      cost: providerCost,
    };
    setCurrentResult(newGen);
    setHistory(prev => [newGen, ...prev].slice(0, MAX_HISTORY));

    try {
      const res = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim(),
          seed: seed || Math.floor(Math.random() * 1000000),
          providerId,
          format: "image",
          width: 1024,
          height: 1024,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation request failed");

      setStatus("succeeded");
      setHistory(prev => prev.map(g => g.id === localId
        ? { ...g, status: "succeeded", fileUrl: data.downloadUrl, thumbUrl: data.thumbUrl }
        : g
      ));
      setCurrentResult(prev => prev?.id === localId
        ? { ...prev, status: "succeeded", fileUrl: data.downloadUrl, thumbUrl: data.thumbUrl }
        : prev
      );
      if (typeof data.balance === "number") {
        setCoinBalance(data.balance);
      }
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Generation failed");
      setHistory(prev => prev.map(g => g.id === localId
        ? { ...g, status: "failed", error: err instanceof Error ? err.message : "failed" }
        : g
      ));
    }
  }, [prompt, negativePrompt, providerId, seed, promptValid, canAfford, coinBalance, providerCost]);

  /* ------------------------- Save to gallery ---------------------- */
  const handleSaveToGallery = useCallback(async (gen: Generation) => {
    if (!gen.fileUrl) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gen.fileUrl,
          caption: gen.prompt.slice(0, 200),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setHistory(prev => prev.map(g => g.id === gen.id ? { ...g, status: "succeeded" } : g));
      setStatus("succeeded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStatus("succeeded"); // generation itself succeeded
    }
  }, []);

  const handleDownload = useCallback((url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]+/gi, "_")}.jpg`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleUsePrompt = (p: string) => {
    setPrompt(p);
    setError(null);
  };

  /* ------------------------- Loading + auth guards ---------------- */
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono" style={{ backgroundColor: T.bgColor, color: T.accentColor }}>
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div>Loading generator...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn redirectUrl="/generate" />;
  }

  const isWorking = status === "submitting" || status === "polling";

  /* ------------------------- Render -------------------------------- */
  return (
    <div className="min-h-screen relative" style={{ backgroundColor: T.bgColor, color: T.textColor, fontFamily: "monospace" }}>
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}

      <div className="w-full bg-black py-1.5 border-b-2 overflow-hidden flex" style={{ borderColor: T.borderColor, color: T.accentColor }}>
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>AI IMAGE GENERATOR // POLLINATIONS + TOGETHER.AI + FAL.AI</span>
          <span>FREE FLUX MODELS // INSTANT RENDER</span>
          <span>ALL RENDERS MINT TO YOUR GALLERY AUTOMATICALLY</span>
        </div>
      </div>

      {/* HERO */}
      <section className="relative border-b-2" style={{ borderColor: T.borderColor, background: `linear-gradient(180deg, ${T.boxBg} 0%, ${T.bgColor} 100%)` }}>
        <div className="max-w-6xl mx-auto px-6 py-12 md:py-16 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] uppercase tracking-widest mb-4"
            style={{ borderColor: T.accentColor + "60", color: T.accentColor, backgroundColor: T.accentColor + "10" }}>
            <Sparkles size={12} />
            <span>FLUX Image Engine</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-3" style={{ color: T.headerColor }}>
            AI Image Generator
          </h1>
          <p className="text-sm md:text-base max-w-2xl mx-auto opacity-70">
            Type a prompt. Pick a style. Watch the universe render itself. Every image mints to your gallery in seconds.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-6 text-[11px]">
            <div className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <Coins size={14} style={{ color: T.accentColor }} />
              <span style={{ color: T.accentColor }}>{coinBalance ?? "—"}</span>
              <span className="opacity-60">LiTBit Coins</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <Zap size={14} style={{ color: T.accentColor }} />
              <span>~30s avg render</span>
            </div>
            <Link href="/gallery" className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg hover:opacity-80" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <ImageIcon size={14} />
              <span>View Gallery</span>
            </Link>
          </div>
        </div>
      </section>

      {/* MAIN GRID */}
      <section className="max-w-6xl mx-auto px-4 md:px-6 py-8 grid lg:grid-cols-5 gap-6 relative z-10">
        {/* ─────────── LEFT: CONTROLS ─────────── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Prompt */}
          <div className="border rounded-lg p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
              Your Vision
            </label>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setError(null); }}
              placeholder="A cyberpunk city at midnight with neon rain..."
              rows={4}
              disabled={isWorking}
              className="w-full px-3 py-2 text-sm rounded outline-none resize-none disabled:opacity-50"
              style={{
                backgroundColor: T.bgColor,
                border: `1px solid ${T.borderColor}`,
                color: T.textColor,
              }}
            />
            <div className="text-right text-[10px] mt-1" style={{ color: T.textMuted }}>
              {prompt.length} chars {promptValid ? "✓" : "(min 3)"}
            </div>
          </div>

          {/* Provider Selector */}
          <div className="border rounded-lg p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>
                Image Provider
              </label>
              <div className="text-[10px] flex items-center gap-1" style={{ color: T.accentColor }}>
                <Coins size={11} /> {providerCost === 0 ? "FREE" : `${providerCost} per image`}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {([
                { id: "pollinations" as const, label: "Pollinations (Free)", desc: "FLUX + SDXL · No API key needed", cost: 0 },
                { id: "together" as const, label: "Together.ai (FLUX)", desc: "FLUX.1 Schnell · Fast, high-quality", cost: 2 },
                { id: "fal" as const, label: "FAL.ai (FLUX)", desc: "FLUX Pro · Generous free tier", cost: 3 },
              ]).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProviderId(p.id)}
                  disabled={isWorking}
                  className="p-3 text-left text-[11px] rounded border transition-all hover:scale-[1.01] disabled:opacity-50"
                  style={{
                    backgroundColor: providerId === p.id ? T.accentColor + "20" : T.bgColor,
                    borderColor: providerId === p.id ? T.accentColor : T.borderColor,
                    color: providerId === p.id ? T.accentColor : T.textColor,
                  }}
                >
                  <div className="font-bold">{p.label}</div>
                  <div className="text-[9px] opacity-60 mt-0.5">{p.desc} · {p.cost === 0 ? "FREE" : `${p.cost} 🪙`}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced (collapsible) */}
          <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-[10px] uppercase tracking-widest"
              style={{ color: T.textMuted }}
            >
              <span>Advanced Options</span>
              <span>{showAdvanced ? "−" : "+"}</span>
            </button>
            {showAdvanced && (
              <div className="px-4 pb-4 space-y-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: T.textMuted }}>
                    Negative Prompt
                  </label>
                  <input
                    value={negativePrompt}
                    onChange={e => setNegativePrompt(e.target.value)}
                    placeholder="blurry, low quality, distorted..."
                    disabled={isWorking}
                    className="w-full px-3 py-2 text-sm rounded outline-none disabled:opacity-50"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: T.textMuted }}>
                    Seed (0 = random)
                  </label>
                  <input
                    type="number"
                    value={seed}
                    onChange={e => setSeed(parseInt(e.target.value) || 0)}
                    min={0}
                    disabled={isWorking}
                    className="w-full px-3 py-2 text-sm rounded outline-none disabled:opacity-50"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Prompt presets */}
          <div className="border rounded-lg p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>
              Quick Starters
            </label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {PROMPT_PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleUsePrompt(p)}
                  disabled={isWorking}
                  className="w-full text-left text-[11px] px-2 py-1.5 rounded border hover:opacity-80 disabled:opacity-50 line-clamp-2"
                  style={{ backgroundColor: T.bgColor, borderColor: T.borderColor, color: T.textColor }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!promptValid || !canAfford || isWorking}
            className="w-full py-4 rounded-lg font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.01]"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`,
              color: T.bgColor,
              boxShadow: `0 0 30px ${T.accentColor}40`,
            }}
          >
            {status === "submitting" ? (
              <><Loader2 size={18} className="animate-spin" /> Submitting...</>
            ) : status === "polling" ? (
              <><Loader2 size={18} className="animate-spin" /> Rendering...</>
            ) : (
              <><Wand2 size={18} /> Generate ({providerCost === 0 ? "FREE" : `${providerCost} 🪙`})</>
            )}
          </button>

          {!canAfford && coinBalance !== null && (
            <div className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>
              <AlertTriangle size={12} />
              <span>Need {providerCost - coinBalance} more coins. Claim daily or buy credits.</span>
            </div>
          )}
          {error && (
            <div className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>
              <AlertTriangle size={12} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* ─────────── RIGHT: PREVIEW + HISTORY ─────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Preview canvas */}
          <div className="border-2 rounded-lg overflow-hidden" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest" style={{ color: T.textMuted }}>
                <ImageIcon size={12} />
                <span>Preview</span>
              </div>
              {currentResult?.status === "succeeded" && (
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: T.accentColor }}>
                  <CheckCircle2 size={12} /> Ready
                </div>
              )}
              {isWorking && (
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: T.accentColor }}>
                  <Loader2 size={12} className="animate-spin" />
                  {status === "submitting" ? "Generating..." : "Rendering..."}
                </div>
              )}
            </div>

            <div className="aspect-video relative flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
              {currentResult?.fileUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentResult.fileUrl}
                  alt={currentResult.prompt}
                  className="w-full h-full object-cover"
                />
              ) : isWorking ? (
                <div className="text-center">
                  <div className="relative w-24 h-24 mx-auto mb-4">
                    <div className="absolute inset-0 rounded-full border-2 animate-ping" style={{ borderColor: T.accentColor, opacity: 0.4 }} />
                    <div className="absolute inset-2 rounded-full border-2 animate-pulse" style={{ borderColor: T.accentColor, opacity: 0.6 }} />
                    <div className="absolute inset-0 flex items-center justify-center text-3xl">🎨</div>
                  </div>
                  <p className="text-sm opacity-70">Rendering your universe...</p>
                  <p className="text-[10px] opacity-50 mt-1">This usually takes 20–60 seconds</p>
                </div>
              ) : status === "failed" ? (
                <div className="text-center px-6">
                  <div className="text-4xl mb-3">⚠️</div>
                  <p className="text-sm" style={{ color: "#f85149" }}>{error || "Generation failed"}</p>
                  <button
                    onClick={handleGenerate}
                    className="mt-4 px-4 py-2 text-xs font-bold rounded flex items-center gap-1.5 mx-auto"
                    style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                  >
                    <RefreshCw size={12} /> Try Again
                  </button>
                </div>
              ) : (
                <div className="text-center px-6">
                  <div className="text-5xl mb-3 opacity-30">🖼️</div>
                  <p className="text-sm opacity-60">Your creation will appear here</p>
                  <p className="text-[10px] opacity-40 mt-1">Type a prompt and hit Generate</p>
                </div>
              )}
            </div>

            {/* Action bar */}
            {currentResult?.fileUrl && (
              <div className="px-4 py-3 border-t flex flex-wrap items-center gap-2" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                <button
                  onClick={() => handleSaveToGallery(currentResult)}
                  disabled={status === "saving"}
                  className="px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 disabled:opacity-50"
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  {status === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save to Gallery
                </button>
                <button
                  onClick={() => handleDownload(currentResult.fileUrl!, currentResult.prompt)}
                  className="px-3 py-1.5 text-xs font-bold rounded border flex items-center gap-1.5"
                  style={{ borderColor: T.borderColor, color: T.textColor }}
                >
                  <Download size={12} /> Download
                </button>
                <button
                  onClick={handleGenerate}
                  className="px-3 py-1.5 text-xs font-bold rounded border flex items-center gap-1.5"
                  style={{ borderColor: T.borderColor, color: T.textColor }}
                >
                  <RefreshCw size={12} /> Regenerate
                </button>
                <div className="ml-auto text-[10px] opacity-60 truncate max-w-[200px]">
                  {currentResult.provider} · {currentResult.cost === 0 ? "FREE" : `${currentResult.cost} 🪙`}
                </div>
              </div>
            )}
          </div>

          {/* History */}
          <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: T.borderColor }}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest" style={{ color: T.textMuted }}>
                <History size={12} />
                <span>Recent Generations ({history.length})</span>
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="text-[10px] opacity-60 hover:opacity-100"
                >
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="p-8 text-center text-xs opacity-50">
                No generations yet. Your creations will appear here.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
                {history.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setCurrentResult(g)}
                    className="relative aspect-video border rounded overflow-hidden group hover:scale-[1.02] transition-transform"
                    style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}
                  >
                    {g.fileUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.fileUrl} alt={g.prompt} className="w-full h-full object-cover" />
                    ) : g.status === "failed" ? (
                      <div className="w-full h-full flex items-center justify-center text-2xl">⚠️</div>
                    ) : g.status === "polling" || g.status === "submitting" ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 size={20} className="animate-spin opacity-50" />
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">🎨</div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 px-2 py-1 text-[9px] truncate" style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "white" }}>
                      {g.provider}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER NOTE */}
      <section className="max-w-6xl mx-auto px-6 pb-12 text-center text-[10px] opacity-50 relative z-10">
        Powered by Pollinations + Together.ai + FAL.ai · Costs debited in LiTBit Coins · Save to Gallery persists to your account
      </section>
    </div>
  );
}
