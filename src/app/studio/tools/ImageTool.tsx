"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Wand2, Save, Download, RefreshCw, Coins, AlertTriangle,
  CheckCircle2, Loader2, History, Sparkles
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

export default function ImageTool() {
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

  /* Persist history */
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

  /* Fetch coin balance */
  useEffect(() => {
    fetch("/api/wallet")
      .then(r => r.json())
      .then(d => { if (typeof d.balance === "number") setCoinBalance(d.balance); })
      .catch(() => { /* silent */ });
  }, []);

  const providerCost = providerId === "pollinations" ? 0 : providerId === "together" ? 2 : providerId === "fal" ? 3 : 0;
  const canAfford = coinBalance === null || coinBalance >= providerCost;
  const promptValid = prompt.trim().length >= 3;

  const handleGenerate = useCallback(async () => {
    if (!promptValid) { setError("Prompt must be at least 3 characters."); return; }
    if (!canAfford) { setError(`Not enough LiTBit Coins. Need ${providerCost}, have ${coinBalance}.`); return; }

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
      if (typeof data.balance === "number") setCoinBalance(data.balance);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Generation failed");
      setHistory(prev => prev.map(g => g.id === localId
        ? { ...g, status: "failed", error: err instanceof Error ? err.message : "failed" }
        : g
      ));
    }
  }, [prompt, negativePrompt, providerId, seed, promptValid, canAfford, coinBalance, providerCost]);

  const handleSaveToGallery = useCallback(async (gen: Generation) => {
    if (!gen.fileUrl) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gen.fileUrl, caption: gen.prompt.slice(0, 200) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus("succeeded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStatus("succeeded");
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

  const handleClearHistory = () => { setHistory([]); localStorage.removeItem(STORAGE_KEY); };
  const handleUsePrompt = (p: string) => { setPrompt(p); setError(null); };

  const isWorking = status === "submitting" || status === "polling";

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      {/* Top bar: coins + heading */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: T.accentColor }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Image Generator</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border" style={{ borderColor: T.borderColor, color: T.accentColor, backgroundColor: T.boxBg }}>
          <Coins size={11} /> {coinBalance ?? "—"} LiTBit
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-2 space-y-3">
          {/* Prompt */}
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: T.textMuted }}>Your Vision</label>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setError(null); }}
              placeholder="A cyberpunk city at midnight with neon rain..."
              rows={4}
              disabled={isWorking}
              className="w-full px-3 py-2 text-sm rounded outline-none resize-none disabled:opacity-50"
              style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
            />
            <div className="text-right text-[10px] mt-1" style={{ color: T.textMuted }}>{prompt.length} chars {promptValid ? "✓" : "(min 3)"}</div>
          </div>

          {/* Provider Selector */}
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>Provider</label>
              <div className="text-[10px] flex items-center gap-1" style={{ color: T.accentColor }}>
                <Coins size={10} /> {providerCost === 0 ? "FREE" : `${providerCost} 🪙`}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {([
                { id: "pollinations" as const, label: "Pollinations (Free)", desc: "FLUX + SDXL", cost: 0 },
                { id: "together" as const, label: "Together.ai (FLUX)", desc: "FLUX.1 Schnell", cost: 2 },
                { id: "fal" as const, label: "FAL.ai (FLUX)", desc: "FLUX Pro", cost: 3 },
              ]).map(p => (
                <button key={p.id} type="button" onClick={() => setProviderId(p.id)} disabled={isWorking}
                  className="p-2.5 text-left text-[11px] rounded border transition-all hover:scale-[1.01] disabled:opacity-50"
                  style={{ backgroundColor: providerId === p.id ? T.accentColor + "20" : T.bgColor, borderColor: providerId === p.id ? T.accentColor : T.borderColor, color: providerId === p.id ? T.accentColor : T.textColor }}>
                  <div className="font-bold">{p.label}</div>
                  <div className="text-[9px] opacity-60 mt-0.5">{p.desc} · {p.cost === 0 ? "FREE" : `${p.cost} 🪙`}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced */}
          <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <button type="button" onClick={() => setShowAdvanced(v => !v)}
              className="w-full px-3 py-2 flex items-center justify-between text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>
              <span>Advanced</span><span>{showAdvanced ? "−" : "+"}</span>
            </button>
            {showAdvanced && (
              <div className="px-3 pb-3 space-y-2">
                <div>
                  <label className="block text-[9px] uppercase tracking-widest mb-0.5" style={{ color: T.textMuted }}>Negative Prompt</label>
                  <input value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} placeholder="blurry, low quality..."
                    disabled={isWorking} className="w-full px-2 py-1.5 text-xs rounded outline-none disabled:opacity-50"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-widest mb-0.5" style={{ color: T.textMuted }}>Seed (0 = random)</label>
                  <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value) || 0)} min={0}
                    disabled={isWorking} className="w-full px-2 py-1.5 text-xs rounded outline-none disabled:opacity-50"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
                </div>
              </div>
            )}
          </div>

          {/* Quick starters */}
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: T.textMuted }}>Quick Starters</label>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {PROMPT_PRESETS.map((p, i) => (
                <button key={i} type="button" onClick={() => handleUsePrompt(p)} disabled={isWorking}
                  className="w-full text-left text-[10px] px-2 py-1 rounded border hover:opacity-80 disabled:opacity-50 line-clamp-2"
                  style={{ backgroundColor: T.bgColor, borderColor: T.borderColor, color: T.textColor }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button type="button" onClick={handleGenerate}
            disabled={!promptValid || !canAfford || isWorking}
            className="w-full py-3 rounded-lg font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.01]"
            style={{ background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`, color: T.bgColor, boxShadow: `0 0 20px ${T.accentColor}30` }}>
            {isWorking ? <><Loader2 size={16} className="animate-spin" /> Generating...</>
              : <><Wand2 size={16} /> Generate ({providerCost === 0 ? "FREE" : `${providerCost} 🪙`})</>}
          </button>

          {error && (
            <div className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>
              <AlertTriangle size={12} /><span>{error}</span>
            </div>
          )}
        </div>

        {/* RIGHT: Preview + History */}
        <div className="lg:col-span-3 space-y-3">
          {/* Preview */}
          <div className="border-2 rounded-lg overflow-hidden" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="px-3 py-1.5 border-b flex items-center justify-between" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
              <span className="text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>Preview</span>
              {currentResult?.status === "succeeded" && <div className="flex items-center gap-1 text-[10px]" style={{ color: T.accentColor }}><CheckCircle2 size={10} /> Ready</div>}
              {isWorking && <div className="flex items-center gap-1 text-[10px]" style={{ color: T.accentColor }}><Loader2 size={10} className="animate-spin" /> Working...</div>}
            </div>
            <div className="aspect-video relative flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
              {currentResult?.fileUrl ? (
                <img src={currentResult.fileUrl} alt={currentResult.prompt} className="w-full h-full object-cover" />
              ) : isWorking ? (
                <div className="text-center">
                  <div className="relative w-20 h-20 mx-auto mb-3">
                    <div className="absolute inset-0 rounded-full border-2 animate-ping" style={{ borderColor: T.accentColor, opacity: 0.4 }} />
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">🎨</div>
                  </div>
                  <p className="text-sm opacity-70">Rendering...</p>
                </div>
              ) : status === "failed" ? (
                <div className="text-center px-6">
                  <div className="text-3xl mb-2">⚠️</div>
                  <p className="text-sm" style={{ color: "#f85149" }}>{error || "Failed"}</p>
                  <button onClick={handleGenerate} className="mt-3 px-3 py-1.5 text-xs font-bold rounded" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                    <RefreshCw size={10} className="inline mr-1" /> Retry
                  </button>
                </div>
              ) : (
                <div className="text-center px-6">
                  <div className="text-4xl mb-2 opacity-30">🖼️</div>
                  <p className="text-sm opacity-60">Your creation will appear here</p>
                </div>
              )}
            </div>
            {currentResult?.fileUrl && (
              <div className="px-3 py-2 border-t flex flex-wrap items-center gap-2" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                <button onClick={() => handleSaveToGallery(currentResult)} disabled={status === "saving"}
                  className="px-2.5 py-1 text-[10px] font-bold rounded flex items-center gap-1 disabled:opacity-50" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                  {status === "saving" ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
                </button>
                <button onClick={() => handleDownload(currentResult.fileUrl!, currentResult.prompt)}
                  className="px-2.5 py-1 text-[10px] font-bold rounded border flex items-center gap-1" style={{ borderColor: T.borderColor, color: T.textColor }}>
                  <Download size={10} /> Download
                </button>
                <button onClick={handleGenerate}
                  className="px-2.5 py-1 text-[10px] font-bold rounded border flex items-center gap-1" style={{ borderColor: T.borderColor, color: T.textColor }}>
                  <RefreshCw size={10} /> Regen
                </button>
                <div className="ml-auto text-[9px] opacity-60">{currentResult.provider} · {currentResult.cost === 0 ? "FREE" : `${currentResult.cost} 🪙`}</div>
              </div>
            )}
          </div>

          {/* History */}
          <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.borderColor }}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>
                <History size={10} /> Recent ({history.length})
              </div>
              {history.length > 0 && <button onClick={handleClearHistory} className="text-[9px] opacity-60 hover:opacity-100">Clear</button>}
            </div>
            {history.length === 0 ? (
              <div className="p-6 text-center text-xs opacity-50">No generations yet.</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 p-2">
                {history.map(g => (
                  <button key={g.id} onClick={() => setCurrentResult(g)}
                    className="relative aspect-video border rounded overflow-hidden group hover:scale-[1.02] transition-transform"
                    style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                    {g.fileUrl ? <img src={g.fileUrl} alt={g.prompt} className="w-full h-full object-cover" />
                      : g.status === "failed" ? <div className="w-full h-full flex items-center justify-center text-xl">⚠️</div>
                      : <div className="w-full h-full flex items-center justify-center"><Loader2 size={16} className="animate-spin opacity-50" /></div>}
                    <div className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[8px] truncate" style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "white" }}>{g.provider}</div>
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
