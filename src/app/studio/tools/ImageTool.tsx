"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Wand2, Save, Download, RefreshCw, Coins, AlertTriangle,
  CheckCircle2, Loader2, History, Sparkles, Gift,
  Terminal, Layers, Plus, X, Trash2, Copy, Zap, Maximize2
} from "lucide-react";
import { MediaProviderId } from "@/lib/media";

type Workspace = {
  id: string;
  name: string;
  prompt: string;
  negativePrompt: string;
  providerId: MediaProviderId;
  aspectRatio: string;
  imageSize: string;
  seed: number;
};

type LogEntry = {
  id: string;
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
};

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
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "4:3" | "3:4" | "16:9" | "9:16">("1:1");
  const [imageSize, setImageSize] = useState<"1K" | "2K">("1K");

  const ASPECT_OPTIONS = [
    { label: "Square", value: "1:1" as const, width: 1024, height: 1024 },
    { label: "Wide",   value: "16:9" as const, width: 1344, height: 768 },
    { label: "Tall",   value: "9:16" as const, width: 768,  height: 1344 },
    { label: "Wide HD", value: "4:3" as const, width: 1024, height: 768 },
    { label: "Tall HD", value: "3:4" as const, width: 768,  height: 1024 },
  ];
  const currentAspect = ASPECT_OPTIONS.find(a => a.value === aspectRatio)!;

  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [batchSize, setBatchSize] = useState<1 | 2 | 4>(1);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [imgError, setImgError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([
    { id: "ws_default", name: "Default", prompt: "", negativePrompt: "", providerId: "pollinations", aspectRatio: "1:1", imageSize: "1K", seed: 0 },
  ]);
  const [activeWsId, setActiveWsId] = useState("ws_default");
  const [editingWsName, setEditingWsName] = useState<string | null>(null);
  const [wsNameInput, setWsNameInput] = useState("");

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

  /* Fetch coin balance - sync from localStorage first for consistency */
  useEffect(() => {
    // Read from localStorage first (consistent with Navbar)
    try {
      const raw = localStorage.getItem("litcoins");
      if (raw) {
        const val = Number(raw);
        if (!isNaN(val)) setCoinBalance(val);
      }
    } catch { /* ignore */ }
    
    // Then sync from API
    fetch("/api/wallet")
      .then(r => r.json())
      .then(d => { 
        if (typeof d.balance === "number") {
          setCoinBalance(d.balance);
          // Update localStorage for consistency
          try { localStorage.setItem("litcoins", String(d.balance)); } catch {}
        }
      })
      .catch(() => { /* silent */ });
  }, []);

  /* Load workspaces */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("litlabs-workspaces");
      if (raw) { const parsed = JSON.parse(raw); if (parsed.length) { setWorkspaces(parsed); setActiveWsId(parsed[0].id); } }
    } catch { /* ignore */ }
  }, []);

  /* Save workspaces */
  useEffect(() => { try { localStorage.setItem("litlabs-workspaces", JSON.stringify(workspaces)); } catch { /* ignore */ } }, [workspaces]);

  /* Sync current inputs to active workspace */
  useEffect(() => {
    setWorkspaces(prev => prev.map(w => w.id === activeWsId
      ? { ...w, prompt, negativePrompt, providerId, aspectRatio, imageSize, seed }
      : w
    ));
  }, [prompt, negativePrompt, providerId, aspectRatio, imageSize, seed, activeWsId]);

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}:${now.getSeconds().toString().padStart(2,"0")}`;
    setLogs(prev => [{ id: `log_${Date.now()}_${Math.random()}`, time, level, message }, ...prev].slice(0, 50));
  }, []);

  const enhancePrompt = useCallback(() => {
    if (!prompt.trim()) return;
    const enhancers = [
      ", highly detailed, 8k resolution, cinematic lighting",
      ", ultra realistic, professional photography, sharp focus",
      ", digital art, concept art, trending on artstation",
      ", octane render, unreal engine 5, volumetric fog",
    ];
    const pick = enhancers[Math.floor(Math.random() * enhancers.length)];
    setPrompt(prev => prev + pick);
    addLog("info", `Prompt enhanced with: ${pick.slice(2, 40)}...`);
  }, [prompt, addLog]);

  const createWorkspace = useCallback(() => {
    const id = `ws_${Date.now()}`;
    const name = `Session ${workspaces.length + 1}`;
    const ws: Workspace = { id, name, prompt, negativePrompt, providerId, aspectRatio, imageSize, seed };
    setWorkspaces(prev => [...prev, ws]);
    setActiveWsId(id);
    addLog("info", `Workspace "${name}" created from current settings`);
  }, [workspaces.length, prompt, negativePrompt, providerId, aspectRatio, imageSize, seed, addLog]);

  const deleteWorkspace = useCallback((id: string) => {
    if (workspaces.length <= 1) { addLog("warn", "Cannot delete last workspace"); return; }
    const next = workspaces.filter(w => w.id !== id);
    setWorkspaces(next);
    if (activeWsId === id) { setActiveWsId(next[0].id); loadWorkspace(next[0]); }
    addLog("info", "Workspace deleted");
  }, [workspaces, activeWsId, addLog]);

  function loadWorkspace(ws: Workspace) {
    setPrompt(ws.prompt); setNegativePrompt(ws.negativePrompt); setProviderId(ws.providerId);
    setAspectRatio(ws.aspectRatio as any); setImageSize(ws.imageSize as any); setSeed(ws.seed);
  }

  const providerCost = 
    providerId === "pollinations" ? 0 : 
    providerId === "gemini" ? 1 : 
    providerId === "together" ? 2 :
    providerId === "fal" ? 3 :
    providerId === "recraft" ? 3 :
    providerId === "openai" ? 5 : 0;
  const canAfford = coinBalance === null || coinBalance >= providerCost * batchSize;
  const promptValid = prompt.trim().length >= 3;
  const promptQuality = prompt.trim().length < 10 ? "weak" : prompt.trim().length < 30 ? "fair" : "good";

  const handleGenerate = useCallback(async () => {
    if (!promptValid) { setError("Prompt must be at least 3 characters."); return; }
    const totalCost = providerCost * batchSize;
    if (!canAfford) { setError(`Not enough LiTBit Coins. Need ${totalCost}, have ${coinBalance}.`); return; }

    setError(null);
    setImgError(null);
    setStatus("submitting");
    addLog("info", `Starting batch of ${batchSize} image(s) via ${providerId}...`);

    const results: Generation[] = [];
    for (let i = 0; i < batchSize; i++) {
      const localId = `gen_${Date.now()}_${i}`;
      const newGen: Generation = {
        id: localId,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        provider: providerId,
        status: "submitting",
        createdAt: Date.now(),
        cost: providerCost,
      };
      results.push(newGen);
      setHistory(prev => [newGen, ...prev].slice(0, MAX_HISTORY));
      if (i === 0) setCurrentResult(newGen);

      try {
        addLog("info", `[${i + 1}/${batchSize}] Dispatching to ${providerId}...`);
        const res = await fetch("/api/media/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            negativePrompt: negativePrompt.trim(),
            seed: seed || Math.floor(Math.random() * 1000000),
            providerId,
            format: "image",
            width: currentAspect.width,
            height: currentAspect.height,
            aspectRatio: currentAspect.value,
            imageSize: providerId === "gemini" ? imageSize : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Generation request failed");

        setHistory(prev => prev.map(g => g.id === localId
          ? { ...g, status: "succeeded", fileUrl: data.downloadUrl, thumbUrl: data.thumbUrl }
          : g
        ));
        if (i === 0) {
          setCurrentResult(prev => prev?.id === localId
            ? { ...prev, status: "succeeded", fileUrl: data.downloadUrl, thumbUrl: data.thumbUrl }
            : prev
          );
        }
        addLog("success", `[${i + 1}/${batchSize}] Image generated · ${data.providerId} · ${data.free ? "FREE" : data.cost + " 🪙"}`);
        if (typeof data.balance === "number") setCoinBalance(data.balance);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        addLog("error", `[${i + 1}/${batchSize}] ${msg}`);
        setHistory(prev => prev.map(g => g.id === localId
          ? { ...g, status: "failed", error: msg }
          : g
        ));
        if (i === 0) {
          setError(msg);
          setCurrentResult(prev => prev?.id === localId ? { ...prev, status: "failed", error: msg } : prev);
        }
      }
    }
    setStatus(results.every(r => r.status === "succeeded") ? "succeeded" : "failed");
    addLog("info", `Batch complete — ${results.filter(r => r.status === "succeeded").length}/${batchSize} succeeded`);
  }, [prompt, negativePrompt, providerId, seed, aspectRatio, currentAspect, imageSize, batchSize, promptValid, canAfford, coinBalance, providerCost, addLog]);

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
      setError("Saved to Gallery ✓");
      setTimeout(() => setError(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStatus("succeeded");
    }
  }, []);

  const handleDownload = useCallback(async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${name.replace(/[^a-z0-9]+/gi, "_")}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  }, []);

  const handleClearHistory = () => { setHistory([]); localStorage.removeItem(STORAGE_KEY); };
  const handleUsePrompt = (p: string) => { setPrompt(p); setError(null); };

  const handleClaimBonus = useCallback(async () => {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily" }),
      });
      const data = await res.json();
      if (res.ok && typeof data.balance === "number") {
        setCoinBalance(data.balance);
        setError(`Daily bonus claimed! +50 LiTBit Coins`);
        setTimeout(() => setError(null), 3000);
      } else {
        setError(data.error || "Failed to claim bonus");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setClaiming(false);
    }
  }, []);

  const isWorking = status === "submitting" || status === "polling";

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: T.accentColor }} />
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: T.headerColor }}>Neural Imaging Studio</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowLogs(v => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border transition-all hover:scale-105"
            style={{ borderColor: T.borderColor, color: T.textMuted, backgroundColor: T.boxBg }}>
            <Terminal size={10} /> {showLogs ? "Hide" : "Show"} Log
          </button>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border" style={{ borderColor: T.borderColor, color: T.accentColor, backgroundColor: T.boxBg }}>
            <Coins size={11} /> {coinBalance ?? "—"} LiTBit
          </div>
          <button onClick={handleClaimBonus} disabled={claiming}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border transition-all hover:scale-105 disabled:opacity-50"
            style={{ borderColor: T.accentColor, color: T.bgColor, backgroundColor: T.accentColor }}
            title="Claim 50 free LiTBit Coins daily">
            <Gift size={11} /> {claiming ? "..." : "Claim"}
          </button>
        </div>
      </div>

      {/* Workspace Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 select-none">
        {workspaces.map(ws => (
          <div key={ws.id} className="flex items-center shrink-0 relative group">
            {editingWsName === ws.id ? (
              <input autoFocus value={wsNameInput} onChange={e => setWsNameInput(e.target.value)}
                onBlur={() => { setWorkspaces(prev => prev.map(w => w.id === ws.id ? { ...w, name: wsNameInput || w.name } : w)); setEditingWsName(null); }}
                onKeyDown={e => { if (e.key === "Enter") { setWorkspaces(prev => prev.map(w => w.id === ws.id ? { ...w, name: wsNameInput || w.name } : w)); setEditingWsName(null); } }}
                className="px-2 py-1 text-[10px] font-bold rounded outline-none w-24"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.accentColor}`, color: T.textColor }} />
            ) : (
              <div
                onClick={() => { if (activeWsId !== ws.id) { setActiveWsId(ws.id); loadWorkspace(ws); } }}
                onDoubleClick={() => { setEditingWsName(ws.id); setWsNameInput(ws.name); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer"
                style={{
                  backgroundColor: activeWsId === ws.id ? T.accentColor + "18" : T.bgColor,
                  borderColor: activeWsId === ws.id ? T.accentColor : T.borderColor + "40",
                  color: activeWsId === ws.id ? T.accentColor : T.textMuted,
                }}>
                <Layers size={9} /> {ws.name}
                {workspaces.length > 1 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id); }}
                    className="ml-0.5 opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-pointer flex items-center"
                    role="button" aria-label="Delete workspace">
                    <X size={9} />
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
        <button onClick={createWorkspace}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border transition-all hover:scale-105"
          style={{ borderColor: T.accentColor + "40", color: T.accentColor }}>
          <Plus size={10} /> New
        </button>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-2 space-y-3">
          {/* Prompt */}
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>Your Vision</label>
              <button onClick={enhancePrompt} disabled={!prompt.trim() || isWorking}
                className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border transition-all hover:scale-105 disabled:opacity-30"
                style={{ borderColor: T.accentColor + "30", color: T.accentColor }}>
                <Zap size={9} /> Enhance
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setError(null); }}
              placeholder="A cyberpunk city at midnight with neon rain..."
              rows={4}
              disabled={isWorking}
              className="w-full px-3 py-2 text-sm rounded outline-none resize-none disabled:opacity-50"
              style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
            />
            <div className="flex items-center justify-between mt-1">
              <div className="text-[10px]" style={{ color: promptQuality === "weak" ? "#f85149" : promptQuality === "fair" ? "#d29922" : "#3fb950" }}>
                {promptQuality === "weak" ? "⚠️ Too short — describe the scene in detail" : promptQuality === "fair" ? "💡 Add more detail for better results" : "✓ Good prompt"}
              </div>
              <div className="text-[10px]" style={{ color: T.textMuted }}>{prompt.length} chars {promptValid ? "✓" : "(min 3)"}</div>
            </div>
          </div>

          {/* Provider Selector */}
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>Provider</label>
              <div className="text-[10px] flex items-center gap-1" style={{ color: T.accentColor }}>
                <Coins size={10} /> {providerCost === 0 ? "FREE" : `${providerCost} 🪙`}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto">
              {([
                { id: "pollinations" as const, label: "Pollinations (Free)", desc: "FLUX + SDXL, works without API key", cost: 0, status: "ready" as const },
                { id: "gemini" as const, label: "Gemini (Imagen 3)", desc: "Google Imagen 3, needs GEMINI_API_KEY", cost: 1, status: "needs-key" as const },
                { id: "together" as const, label: "Together.ai (FLUX)", desc: "FLUX.1 Schnell, needs TOGETHER_API_KEY", cost: 2, status: "needs-key" as const },
                { id: "fal" as const, label: "FAL.ai (FLUX Pro)", desc: "FLUX.1 Pro, needs FAL_KEY", cost: 3, status: "needs-key" as const },
                { id: "openai" as const, label: "OpenAI (DALL-E 3)", desc: "DALL-E 3 photorealistic, needs OPENAI_API_KEY", cost: 5, status: "needs-key" as const },
                { id: "recraft" as const, label: "Recraft (Vector)", desc: "SVG/vector art, needs RECRAFT_API_KEY", cost: 3, status: "needs-key" as const },
              ]).map(p => (
                <button key={p.id} type="button" onClick={() => setProviderId(p.id)} disabled={isWorking}
                  className="p-2.5 text-left text-[11px] rounded border transition-all hover:scale-[1.01] disabled:opacity-50 group relative"
                  style={{ backgroundColor: providerId === p.id ? T.accentColor + "20" : T.bgColor, borderColor: providerId === p.id ? T.accentColor : T.borderColor, color: providerId === p.id ? T.accentColor : T.textColor }}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${p.status === "ready" ? "bg-green-500" : "bg-amber-500"}`} />
                    <span className="font-bold">{p.label}</span>
                  </div>
                  <div className="text-[9px] opacity-60 mt-0.5 ml-3">{p.desc} · {p.cost === 0 ? "FREE" : `${p.cost} 🪙`}</div>
                  {p.status === "ready" && providerId !== p.id && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 opacity-0 group-hover:opacity-100 transition-opacity">Ready</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Aspect Ratio</label>
            <div className="grid grid-cols-5 gap-1.5">
              {ASPECT_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setAspectRatio(opt.value)} disabled={isWorking}
                  className="py-2 text-[10px] font-bold rounded border transition-all hover:scale-[1.02] disabled:opacity-50"
                  style={{ backgroundColor: aspectRatio === opt.value ? T.accentColor + "20" : T.bgColor, borderColor: aspectRatio === opt.value ? T.accentColor : T.borderColor, color: aspectRatio === opt.value ? T.accentColor : T.textColor }}>
                  <div>{opt.label}</div>
                  <div className="text-[8px] opacity-60">{opt.value}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Image Size (Gemini only) */}
          {providerId === "gemini" && (
            <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Resolution</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(["1K", "2K"] as const).map(s => (
                  <button key={s} type="button" onClick={() => setImageSize(s)} disabled={isWorking}
                    className="py-2 text-[10px] font-bold rounded border transition-all hover:scale-[1.02] disabled:opacity-50"
                    style={{ backgroundColor: imageSize === s ? T.accentColor + "20" : T.bgColor, borderColor: imageSize === s ? T.accentColor : T.borderColor, color: imageSize === s ? T.accentColor : T.textColor }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

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

          {/* Batch Size */}
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Batch Size</label>
            <div className="grid grid-cols-3 gap-1.5">
              {([1, 2, 4] as const).map(n => (
                <button key={n} type="button" onClick={() => setBatchSize(n)} disabled={isWorking}
                  className="py-2 text-[10px] font-bold rounded border transition-all hover:scale-[1.02] disabled:opacity-50"
                  style={{ backgroundColor: batchSize === n ? T.accentColor + "20" : T.bgColor, borderColor: batchSize === n ? T.accentColor : T.borderColor, color: batchSize === n ? T.accentColor : T.textColor }}>
                  {n}x
                </button>
              ))}
            </div>
            <div className="text-[9px] mt-1.5 opacity-40" style={{ color: T.textMuted }}>
              Total: {providerCost * batchSize} 🪙 · {batchSize} image{batchSize > 1 ? "s" : ""}
            </div>
          </div>

          {/* Generate button */}
          <button type="button" onClick={handleGenerate}
            disabled={!promptValid || !canAfford || isWorking}
            className="w-full py-3 rounded-lg font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.01]"
            style={{ background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`, color: T.bgColor, boxShadow: `0 0 20px ${T.accentColor}30` }}>
            {isWorking ? <><Loader2 size={16} className="animate-spin" /> Generating...</>
              : <><Wand2 size={16} /> Generate {batchSize > 1 ? `${batchSize}x` : ""} ({providerCost * batchSize === 0 ? "FREE" : `${providerCost * batchSize} 🪙`})</>}
          </button>

          {error && (
            <div className="text-[11px] flex flex-col gap-1.5 px-3 py-3 rounded-lg border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514915" }}>
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle size={12} /><span>Generation Failed</span>
              </div>
              <div className="opacity-90 leading-relaxed">{error}</div>
              {providerId === "gemini" && error?.includes("404") && (
                <div className="text-[10px] opacity-75 mt-1" style={{ color: T.textMuted }}>
                  💡 Tip: Try Pollinations (Free) or Together.ai instead — no API key needed!
                </div>
              )}
              {(providerId === "together" || providerId === "openai" || providerId === "fal" || providerId === "recraft") && error?.includes("key missing") && (
                <div className="text-[10px] opacity-75 mt-1" style={{ color: T.textMuted }}>
                  💡 Add your {providerId.toUpperCase()}_API_KEY in Vercel environment variables
                </div>
              )}
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
            <div
              className="relative flex items-center justify-center w-full"
              style={{
                backgroundColor: T.bgColor,
                aspectRatio: aspectRatio === "1:1" ? "1/1" : aspectRatio === "4:3" ? "4/3" : aspectRatio === "3:4" ? "3/4" : aspectRatio === "16:9" ? "16/9" : "9/16",
                maxHeight: "70vh",
              }}
            >
              {currentResult?.fileUrl ? (
                <>
                  <img
                    src={currentResult.fileUrl}
                    alt={currentResult.prompt}
                    className="w-full h-full object-contain"
                    onError={() => setImgError("Image failed to load. Try regenerating.")}
                    onLoad={() => setImgError(null)}
                  />
                  {imgError && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: T.bgColor + "dd" }}>
                      <div className="text-center px-6">
                        <div className="text-3xl mb-2">🖼️</div>
                        <p className="text-sm" style={{ color: "#f85149" }}>{imgError}</p>
                        <button onClick={() => { setImgError(null); handleGenerate(); }}
                          className="mt-3 px-3 py-1.5 text-xs font-bold rounded" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                          <RefreshCw size={10} className="inline mr-1" /> Retry
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : isWorking ? (
                <div className="text-center">
                  <div className="relative w-20 h-20 mx-auto mb-3">
                    <div className="absolute inset-0 rounded-full border-2 animate-ping" style={{ borderColor: T.accentColor, opacity: 0.4 }} />
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">🎨</div>
                  </div>
                  <p className="text-sm opacity-70">Rendering...</p>
                </div>
              ) : status === "failed" ? (
                <div className="text-center px-6 py-8">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ backgroundColor: "#f8514920" }}>
                    <AlertTriangle size={28} style={{ color: "#f85149" }} />
                  </div>
                  <p className="text-sm font-bold mb-1" style={{ color: "#f85149" }}>Generation Failed</p>
                  <p className="text-xs opacity-60 mb-4 max-w-xs mx-auto">{error || "Something went wrong. Check your API key or try a different provider."}</p>
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={handleGenerate} className="px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                      <RefreshCw size={12} /> Retry
                    </button>
                    <button onClick={() => setProviderId("pollinations")} className="px-4 py-2 text-xs font-bold rounded-lg border flex items-center gap-1.5" style={{ borderColor: T.borderColor, color: T.textMuted }}>
                      <Zap size={12} /> Try Free
                    </button>
                  </div>
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
                <button onClick={() => handleDownload(currentResult.fileUrl!, currentResult.prompt)}
                  className="px-3 py-1.5 text-[11px] font-black rounded flex items-center gap-1.5"
                  style={{ backgroundColor: T.accentColor, color: T.bgColor, boxShadow: `0 0 12px ${T.accentColor}40` }}>
                  <Download size={13} /> Download
                </button>
                <button onClick={() => handleSaveToGallery(currentResult)} disabled={status === "saving"}
                  className="px-3 py-1.5 text-[11px] font-bold rounded border flex items-center gap-1.5 disabled:opacity-50"
                  style={{ borderColor: T.accentColor, color: T.accentColor, backgroundColor: T.accentColor + "10" }}>
                  {status === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save to Gallery
                </button>
                <button onClick={handleGenerate}
                  className="px-3 py-1.5 text-[11px] font-bold rounded border flex items-center gap-1.5" style={{ borderColor: T.borderColor, color: T.textMuted }}>
                  <RefreshCw size={12} /> Regen
                </button>
                <div className="ml-auto text-[9px] opacity-60">{currentResult.provider} · {currentResult.cost === 0 ? "FREE" : `${currentResult.cost} 🪙`} · {aspectRatio}</div>
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
                    {g.fileUrl ? <img src={g.fileUrl} alt={g.prompt} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
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

      {/* CLI Log Panel */}
      {showLogs && (
        <div className="border rounded-lg overflow-hidden" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg, fontFamily: "'JetBrains Mono', monospace" }}>
          <div className="px-3 py-1.5 border-b flex items-center justify-between" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
            <div className="flex items-center gap-2">
              <Terminal size={10} style={{ color: T.accentColor }} />
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>Neural Log</span>
            </div>
            <button onClick={() => setLogs([])} className="text-[9px] opacity-40 hover:opacity-100" style={{ color: T.textMuted }}>Clear</button>
          </div>
          <div className="max-h-40 overflow-y-auto p-2 space-y-1 text-[10px]">
            {logs.length === 0 ? (
              <div className="opacity-30 italic px-1" style={{ color: T.textMuted }}>// No events logged yet...</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="flex gap-2 px-1">
                  <span className="opacity-30 shrink-0" style={{ color: T.textMuted }}>{log.time}</span>
                  <span className="shrink-0 font-bold" style={{
                    color: log.level === "success" ? "#3fb950" : log.level === "error" ? "#f85149" : log.level === "warn" ? "#d29922" : T.accentColor,
                  }}>{log.level.toUpperCase()}</span>
                  <span style={{ color: T.textColor }}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
