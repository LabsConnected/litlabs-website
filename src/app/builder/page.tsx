"use client";
export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";
import {
  Hammer, Wand2, Download, RefreshCw, Coins, AlertTriangle,
  CheckCircle2, Loader2, Sparkles, Layers, Zap, Terminal,
  Upload, X, ChevronRight, Eye, Palette, Layout, Brain,
  ImageIcon, Maximize2, Grid3x3, Square, RectangleHorizontal,
  RectangleVertical, Shuffle, Copy, Trash2, Play, Settings2,
  Crosshair, Atom, Flame, Shield, Clock, Star, Paintbrush
} from "lucide-react";
import { MediaProviderId } from "@/lib/media";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type RemixMode = "reskin" | "style" | "composition" | "mood";
type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
type GenerationStatus = "idle" | "forging" | "succeeded" | "failed";

type ForgeOutput = {
  id: string;
  url: string;
  prompt: string;
  mode: RemixMode;
  provider: MediaProviderId;
  seed: number;
  timestamp: number;
};

type ForgeLog = {
  id: string;
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const REMIX_MODES: { id: RemixMode; label: string; icon: typeof Palette; desc: string }[] = [
  { id: "reskin", label: "Reskin", icon: Palette, desc: "Keep composition, change everything else" },
  { id: "style", label: "Extract Style", icon: Paintbrush, desc: "Pull the artistic style from reference" },
  { id: "composition", label: "Extract Layout", icon: Layout, desc: "Keep structure, change content" },
  { id: "mood", label: "Extract Mood", icon: Flame, desc: "Capture the atmosphere and feeling" },
];

const ASPECT_OPTIONS: { label: string; value: AspectRatio; w: number; h: number }[] = [
  { label: "Square", value: "1:1", w: 1024, h: 1024 },
  { label: "Wide", value: "16:9", w: 1344, h: 768 },
  { label: "Tall", value: "9:16", w: 768, h: 1344 },
  { label: "Landscape", value: "4:3", w: 1024, h: 768 },
  { label: "Portrait", value: "3:4", w: 768, h: 1024 },
];

const PROVIDERS: { id: MediaProviderId; label: string; cost: number; free: boolean }[] = [
  { id: "pollinations", label: "Pollinations", cost: 0, free: true },
  { id: "gemini", label: "Gemini Imagen", cost: 1, free: false },
  { id: "together", label: "Together.ai", cost: 2, free: false },
  { id: "fal", label: "FAL.ai", cost: 3, free: false },
  { id: "openai", label: "OpenAI DALL-E", cost: 5, free: false },
];

const STYLE_PRESETS = [
  "Cyberpunk neon noir", "Oil painting Renaissance", "Japanese ukiyo-e woodblock",
  "Synthwave retro 80s", "Dark fantasy gothic", "Minimalist clean vector",
  "Photorealistic cinematic", "Watercolor impressionist", "Pixel art 16-bit",
  "Comic book halftone", "Stained glass art nouveau", "Charcoal sketch",
];

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
export default function BuilderPage() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Core state
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [remixMode, setRemixMode] = useState<RemixMode>("reskin");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [providerId, setProviderId] = useState<MediaProviderId>("pollinations");
  const [seed, setSeed] = useState(0);
  const [batchSize, setBatchSize] = useState<1 | 2 | 4>(1);

  // Generation state
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [outputs, setOutputs] = useState<ForgeOutput[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<ForgeOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);

  // UI state
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<ForgeLog[]>([]);
  const [activePanel, setActivePanel] = useState<"input" | "forge" | "output">("input");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const currentAspect = ASPECT_OPTIONS.find(a => a.value === aspectRatio)!;
  const currentProvider = PROVIDERS.find(p => p.id === providerId)!;
  const totalCost = currentProvider.cost * batchSize;

  // Fetch wallet
  useEffect(() => {
    fetch("/api/wallet")
      .then(r => r.json())
      .then(d => { if (typeof d.balance === "number") setCoinBalance(d.balance); })
      .catch(() => {});
  }, []);

  const addLog = useCallback((level: ForgeLog["level"], message: string) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    setLogs(prev => [{ id: `log_${Date.now()}`, time, level, message }, ...prev].slice(0, 100));
  }, []);

  /* Reference image upload */
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setReferenceImage(ev.target?.result as string);
      addLog("info", `Reference image loaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
  }, [addLog]);

  /* Build prompt from remix mode + reference */
  const buildRemixPrompt = useCallback((basePrompt: string, mode: RemixMode, hasRef: boolean): string => {
    const modePrefix: Record<RemixMode, string> = {
      reskin: "Reimagine this scene with a completely new look and feel, different colors, textures, and style, but keep the same basic composition and layout",
      style: "Apply the artistic style and visual aesthetic from the reference to this new scene",
      composition: "Use the same spatial arrangement, layout, and compositional structure as the reference, but with entirely new subject matter",
      mood: "Capture and transfer the atmosphere, emotional tone, and lighting mood from the reference to this scene",
    };
    if (hasRef) {
      return `${modePrefix[mode]}. Scene: ${basePrompt}`;
    }
    return basePrompt;
  }, []);

  /* Forge — main generation */
  const handleForge = useCallback(async () => {
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError("Enter a prompt — describe what you want to forge.");
      return;
    }
    if (coinBalance !== null && coinBalance < totalCost) {
      setError(`Not enough LiTBit Coins. Need ${totalCost}, have ${coinBalance}.`);
      return;
    }

    setError(null);
    setStatus("forging");
    addLog("info", `⚡ FORGE STARTED — ${batchSize} variant(s) via ${currentProvider.label}`);

    const finalPrompt = buildRemixPrompt(prompt.trim(), remixMode, !!referenceImage);
    addLog("info", `Mode: ${remixMode} · Aspect: ${aspectRatio} · Provider: ${currentProvider.label}`);

    const newOutputs: ForgeOutput[] = [];

    for (let i = 0; i < batchSize; i++) {
      const variantSeed = seed || Math.floor(Math.random() * 999999);
      const outputId = `forge_${Date.now()}_${i}`;

      try {
        addLog("info", `[${i + 1}/${batchSize}] Forging variant ${i + 1}...`);

        const body: Record<string, unknown> = {
          prompt: finalPrompt,
          negativePrompt: negativePrompt.trim(),
          seed: variantSeed + i,
          providerId,
          format: "image",
          width: currentAspect.w,
          height: currentAspect.h,
          aspectRatio: currentAspect.value,
        };

        if (referenceImage) {
          body.referenceUrl = referenceImage;
        }

        const res = await fetch("/api/media/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Forge failed");

        const output: ForgeOutput = {
          id: outputId,
          url: data.downloadUrl,
          prompt: prompt.trim(),
          mode: remixMode,
          provider: providerId,
          seed: variantSeed + i,
          timestamp: Date.now(),
        };

        newOutputs.push(output);
        setOutputs(prev => [output, ...prev]);
        setSelectedOutput(output);

        addLog("success", `[${i + 1}/${batchSize}] ✓ Variant forged · ${data.free ? "FREE" : data.cost + " 🪙"}`);

        if (typeof data.balance === "number") setCoinBalance(data.balance);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Forge failed";
        addLog("error", `[${i + 1}/${batchSize}] ✗ ${msg}`);
        setError(msg);
      }
    }

    setStatus(newOutputs.length > 0 ? "succeeded" : "failed");
    addLog("info", `⚡ FORGE COMPLETE — ${newOutputs.length}/${batchSize} variants forged`);
  }, [prompt, negativePrompt, remixMode, aspectRatio, providerId, seed, batchSize, referenceImage, totalCost, coinBalance, currentProvider, buildRemixPrompt, addLog]);

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

  const handleClearOutputs = () => { setOutputs([]); setSelectedOutput(null); };

  const isWorking = status === "forging";

  /* Auth gate */
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono" style={{ backgroundColor: T.bgColor, color: T.accentColor }}>
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div>Initializing Forge...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <p className="text-sm opacity-60">Sign in to access the Agent Forge.</p>
        <Link href="/login" className="px-4 py-2 rounded-lg text-sm font-bold" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]" style={{ backgroundColor: T.bgColor, color: T.textColor, fontFamily: "monospace" }}>

      {/* ═══ TOP COMMAND BAR ═══ */}
      <div className="shrink-0 flex items-center justify-between px-4 h-12" style={{ borderBottom: `1px solid ${T.borderColor}15`, backgroundColor: T.boxBg + "40" }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})` }}>
              <Hammer size={12} className="text-white" />
            </div>
            <span className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: T.headerColor }}>Agent Forge</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: T.accentColor + "10", color: T.accentColor, border: `1px solid ${T.accentColor}20` }}>
            <Atom size={9} />
            <span>{remixMode.toUpperCase()} MODE</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Panel toggles for mobile */}
          <div className="flex lg:hidden items-center gap-1">
            {(["input", "forge", "output"] as const).map(panel => (
              <button key={panel} onClick={() => setActivePanel(panel)}
                className="px-2 py-1 text-[9px] font-bold uppercase rounded transition-all"
                style={{
                  backgroundColor: activePanel === panel ? T.accentColor + "20" : "transparent",
                  color: activePanel === panel ? T.accentColor : T.textMuted,
                  border: `1px solid ${activePanel === panel ? T.accentColor + "30" : T.borderColor + "20"}`,
                }}>
                {panel}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold" style={{ backgroundColor: T.accentColor + "10", color: T.accentColor, border: `1px solid ${T.accentColor}20` }}>
            <Coins size={10} /> {coinBalance ?? "—"}
          </div>

          <button onClick={() => setShowLogs(v => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold transition-all"
            style={{ backgroundColor: showLogs ? T.accentColor + "15" : "transparent", color: showLogs ? T.accentColor : T.textMuted, border: `1px solid ${showLogs ? T.accentColor + "30" : T.borderColor + "20"}` }}>
            <Terminal size={9} /> LOG
          </button>
        </div>
      </div>

      {/* ═══ MAIN 3-PANEL LAYOUT ═══ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ─── LEFT: INPUT DECK ─── */}
        <div className={`${activePanel === "input" ? "flex" : "hidden"} lg:flex flex-col w-full lg:w-[320px] xl:w-[360px] shrink-0 overflow-y-auto`}
          style={{ borderRight: `1px solid ${T.borderColor}12`, backgroundColor: T.boxBg + "30" }}>

          <div className="p-4 space-y-4 flex-1">

            {/* Reference Image Upload */}
            <div className="rounded-lg p-3" style={{ border: `1px solid ${T.borderColor}20`, backgroundColor: T.boxBg + "60" }}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
                  <Crosshair size={10} className="inline mr-1" />Reference Image
                </label>
                {referenceImage && (
                  <button onClick={() => setReferenceImage(null)} className="text-[9px] font-bold" style={{ color: "#f85149" }}>
                    <X size={10} className="inline" /> Clear
                  </button>
                )}
              </div>

              {referenceImage ? (
                <div className="relative rounded-lg overflow-hidden" style={{ border: `1px solid ${T.borderColor}30` }}>
                  <img src={referenceImage} alt="Reference" className="w-full h-40 object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                    <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded text-[10px] font-bold" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                      Replace
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-full h-32 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all hover:scale-[1.01]"
                  style={{ borderColor: T.borderColor + "40", color: T.textMuted }}>
                  <Upload size={20} />
                  <span className="text-[10px] font-bold">Drop image or click to upload</span>
                  <span className="text-[9px] opacity-50">JPG, PNG, WebP</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </div>

            {/* Remix Mode Selector */}
            <div className="rounded-lg p-3" style={{ border: `1px solid ${T.borderColor}20`, backgroundColor: T.boxBg + "60" }}>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-2 block" style={{ color: T.textMuted }}>
                <Shuffle size={10} className="inline mr-1" />Remix Mode
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {REMIX_MODES.map(mode => {
                  const Icon = mode.icon;
                  const active = remixMode === mode.id;
                  return (
                    <button key={mode.id} onClick={() => setRemixMode(mode.id)} disabled={isWorking}
                      className="p-2 rounded text-left transition-all disabled:opacity-50"
                      style={{
                        backgroundColor: active ? T.accentColor + "15" : "transparent",
                        border: `1px solid ${active ? T.accentColor + "40" : T.borderColor + "20"}`,
                        color: active ? T.accentColor : T.textColor,
                      }}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon size={11} />
                        <span className="text-[10px] font-bold">{mode.label}</span>
                      </div>
                      <div className="text-[8px] opacity-60 leading-tight">{mode.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prompt Core */}
            <div className="rounded-lg p-3" style={{ border: `1px solid ${T.borderColor}20`, backgroundColor: T.boxBg + "60" }}>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-2 block" style={{ color: T.textMuted }}>
                <Brain size={10} className="inline mr-1" />Prompt Core
              </label>
              <textarea
                value={prompt}
                onChange={e => { setPrompt(e.target.value); setError(null); }}
                placeholder="Describe the agent, scene, or concept you want to forge..."
                rows={4}
                disabled={isWorking}
                className="w-full px-3 py-2 text-sm rounded outline-none resize-none disabled:opacity-50"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[9px]" style={{ color: prompt.trim().length < 10 ? "#f85149" : prompt.trim().length < 30 ? "#d29922" : "#3fb950" }}>
                  {prompt.trim().length < 10 ? "⚠ Too short" : prompt.trim().length < 30 ? "💡 Add more detail" : "✓ Good prompt"}
                </span>
                <span className="text-[9px] opacity-50">{prompt.length} chars</span>
              </div>

              {/* Style Presets */}
              <div className="mt-2">
                <label className="text-[9px] font-bold uppercase tracking-widest mb-1 block" style={{ color: T.textMuted + "80" }}>Style Presets</label>
                <div className="flex flex-wrap gap-1">
                  {STYLE_PRESETS.map(style => (
                    <button key={style} onClick={() => setPrompt(prev => prev ? `${prev}, ${style.toLowerCase()}` : style)}
                      disabled={isWorking}
                      className="px-1.5 py-0.5 text-[8px] font-bold rounded transition-all hover:scale-105 disabled:opacity-50"
                      style={{ backgroundColor: T.accentColor + "10", color: T.accentColor, border: `1px solid ${T.accentColor}20` }}>
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Negative Prompt */}
            <div className="rounded-lg p-3" style={{ border: `1px solid ${T.borderColor}20`, backgroundColor: T.boxBg + "60" }}>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: T.textMuted }}>
                Negative Prompt
              </label>
              <input
                value={negativePrompt}
                onChange={e => setNegativePrompt(e.target.value)}
                placeholder="blurry, low quality, distorted..."
                disabled={isWorking}
                className="w-full px-3 py-1.5 text-xs rounded outline-none disabled:opacity-50"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}
              />
            </div>
          </div>
        </div>

        {/* ─── CENTER: FORGE CORE ─── */}
        <div className={`${activePanel === "forge" ? "flex" : "hidden"} lg:flex flex-col flex-1 overflow-hidden`}>

          {/* Forge Controls Bar */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2 flex-wrap gap-2" style={{ borderBottom: `1px solid ${T.borderColor}10`, backgroundColor: T.boxBg + "20" }}>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Provider */}
              <select value={providerId} onChange={e => setProviderId(e.target.value as MediaProviderId)} disabled={isWorking}
                className="px-2 py-1 text-[10px] font-bold rounded outline-none disabled:opacity-50"
                style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }}>
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.label} {p.free ? "(FREE)" : `(${p.cost} 🪙)`}</option>
                ))}
              </select>

              {/* Aspect Ratio */}
              <div className="flex items-center gap-0.5">
                {ASPECT_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setAspectRatio(opt.value)} disabled={isWorking}
                    className="px-1.5 py-1 text-[9px] font-bold rounded transition-all disabled:opacity-50"
                    style={{
                      backgroundColor: aspectRatio === opt.value ? T.accentColor + "20" : "transparent",
                      color: aspectRatio === opt.value ? T.accentColor : T.textMuted,
                      border: `1px solid ${aspectRatio === opt.value ? T.accentColor + "30" : "transparent"}`,
                    }}
                    title={opt.value}>
                    {opt.value === "1:1" ? <Square size={10} /> : opt.value === "16:9" || opt.value === "4:3" ? <RectangleHorizontal size={10} /> : <RectangleVertical size={10} />}
                  </button>
                ))}
              </div>

              {/* Batch Size */}
              <div className="flex items-center gap-0.5">
                {([1, 2, 4] as const).map(n => (
                  <button key={n} onClick={() => setBatchSize(n)} disabled={isWorking}
                    className="w-6 h-6 text-[9px] font-bold rounded transition-all disabled:opacity-50 flex items-center justify-center"
                    style={{
                      backgroundColor: batchSize === n ? T.accentColor + "20" : "transparent",
                      color: batchSize === n ? T.accentColor : T.textMuted,
                      border: `1px solid ${batchSize === n ? T.accentColor + "30" : T.borderColor + "20"}`,
                    }}>
                    {n}
                  </button>
                ))}
              </div>

              {/* Seed */}
              <div className="flex items-center gap-1">
                <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} disabled={isWorking}
                  placeholder="Seed"
                  className="w-16 px-1.5 py-1 text-[9px] font-mono rounded outline-none disabled:opacity-50"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
                <button onClick={() => setSeed(Math.floor(Math.random() * 999999))} disabled={isWorking}
                  className="p-1 rounded transition-all hover:scale-110 disabled:opacity-50"
                  style={{ color: T.textMuted }} title="Random seed">
                  <Shuffle size={10} />
                </button>
              </div>
            </div>

            {/* Forge Button */}
            <button onClick={handleForge} disabled={isWorking || !prompt.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
              style={{
                background: isWorking
                  ? `linear-gradient(135deg, ${T.accentColor}80, ${T.linkColor}80)`
                  : `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
                color: T.bgColor,
                boxShadow: `0 0 20px ${T.accentColor}40`,
              }}>
              {isWorking ? (
                <><Loader2 size={12} className="animate-spin" /> Forging...</>
              ) : (
                <><Flame size={12} /> Forge ×{batchSize}</>
              )}
            </button>
          </div>

          {/* Forge Output Display */}
          <div className="flex-1 overflow-auto p-4">
            {selectedOutput ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Eye size={12} style={{ color: T.accentColor }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Forge Output</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => handleDownload(selectedOutput.url, selectedOutput.prompt)}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold rounded transition-all hover:scale-105"
                      style={{ backgroundColor: T.accentColor + "15", color: T.accentColor, border: `1px solid ${T.accentColor}25` }}>
                      <Download size={9} /> Download
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(selectedOutput.url); }}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold rounded transition-all hover:scale-105"
                      style={{ backgroundColor: T.boxBg, color: T.textMuted, border: `1px solid ${T.borderColor}25` }}>
                      <Copy size={9} /> Copy URL
                    </button>
                  </div>
                </div>
                <div className="flex-1 rounded-lg overflow-hidden flex items-center justify-center" style={{ backgroundColor: T.boxBg + "40", border: `1px solid ${T.borderColor}15` }}>
                  <img src={selectedOutput.url} alt={selectedOutput.prompt} className="max-w-full max-h-full object-contain" />
                </div>
                <div className="mt-2 flex items-center gap-3 text-[9px]" style={{ color: T.textMuted }}>
                  <span>Mode: <b style={{ color: T.accentColor }}>{selectedOutput.mode}</b></span>
                  <span>Provider: <b>{selectedOutput.provider}</b></span>
                  <span>Seed: <b>{selectedOutput.seed}</b></span>
                  <span>{new Date(selectedOutput.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-4 opacity-40">
                <Hammer size={48} style={{ color: T.accentColor }} />
                <div className="text-center">
                  <p className="text-sm font-black uppercase tracking-widest" style={{ color: T.headerColor }}>Agent Forge</p>
                  <p className="text-[10px] mt-1">Upload a reference, set your mode, write a prompt, and hit Forge.</p>
                  <p className="text-[10px] mt-0.5" style={{ color: T.accentColor }}>Design, test, and launch — all from one battle-ready studio.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT: FORGE CONSOLE + OUTPUTS ─── */}
        <div className={`${activePanel === "output" ? "flex" : "hidden"} lg:flex flex-col w-full lg:w-[280px] xl:w-[320px] shrink-0 overflow-hidden`}
          style={{ borderLeft: `1px solid ${T.borderColor}12`, backgroundColor: T.boxBg + "20" }}>

          {/* Console Header */}
          <div className="shrink-0 flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${T.borderColor}10` }}>
            <div className="flex items-center gap-1.5">
              <Grid3x3 size={10} style={{ color: T.accentColor }} />
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Outputs</span>
              {outputs.length > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: T.accentColor + "15", color: T.accentColor }}>
                  {outputs.length}
                </span>
              )}
            </div>
            {outputs.length > 0 && (
              <button onClick={handleClearOutputs} className="text-[9px] font-bold" style={{ color: "#f85149" }}>
                <Trash2 size={9} className="inline" /> Clear
              </button>
            )}
          </div>

          {/* Output Grid */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {outputs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full opacity-30 gap-2">
                <ImageIcon size={24} style={{ color: T.accentColor }} />
                <span className="text-[9px] font-bold uppercase tracking-widest">No outputs yet</span>
              </div>
            ) : (
              outputs.map(output => (
                <button key={output.id} onClick={() => setSelectedOutput(output)}
                  className="w-full rounded-lg overflow-hidden transition-all hover:scale-[1.02] text-left"
                  style={{
                    border: selectedOutput?.id === output.id ? `2px solid ${T.accentColor}` : `1px solid ${T.borderColor}20`,
                    boxShadow: selectedOutput?.id === output.id ? `0 0 12px ${T.accentColor}30` : "none",
                  }}>
                  <img src={output.url} alt={output.prompt} className="w-full h-32 object-cover" />
                  <div className="p-1.5" style={{ backgroundColor: T.boxBg + "80" }}>
                    <div className="text-[8px] font-bold truncate" style={{ color: T.textColor }}>{output.prompt}</div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[7px]" style={{ color: T.accentColor }}>{output.mode}</span>
                      <span className="text-[7px]" style={{ color: T.textMuted }}>{new Date(output.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Console Log */}
          {showLogs && (
            <div className="shrink-0 h-48 flex flex-col" style={{ borderTop: `1px solid ${T.borderColor}15` }}>
              <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5" style={{ borderBottom: `1px solid ${T.borderColor}10` }}>
                <Terminal size={9} style={{ color: T.accentColor }} />
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Forge Log</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono">
                {logs.length === 0 ? (
                  <div className="text-[9px] opacity-30 text-center mt-4">No log entries</div>
                ) : logs.map(log => (
                  <div key={log.id} className="text-[8px] leading-relaxed" style={{
                    color: log.level === "error" ? "#f85149" : log.level === "success" ? "#3fb950" : log.level === "warn" ? "#d29922" : T.textMuted,
                  }}>
                    <span className="opacity-50">[{log.time}]</span> {log.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ BOTTOM STATUS BAR ═══ */}
      <div className="shrink-0 flex items-center justify-between px-4 h-7" style={{ borderTop: `1px solid ${T.borderColor}10`, backgroundColor: T.boxBg + "30" }}>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold uppercase tracking-wider opacity-40" style={{ color: T.accentColor }}>Agent Forge v1.0</span>
          <span className="text-[9px] opacity-20">·</span>
          <span className="text-[9px] opacity-30" style={{ color: T.textMuted }}>
            {referenceImage ? "✓ Reference loaded" : "No reference"} · {remixMode} · {aspectRatio} · {currentProvider.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-[9px] font-bold flex items-center gap-1" style={{ color: error.includes("✓") ? "#3fb950" : "#f85149" }}>
              <AlertTriangle size={9} /> {error}
            </span>
          )}
          <span className="flex items-center gap-1 text-[9px]" style={{ color: T.textMuted + "80" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status === "forging" ? "#d29922" : "#3fb950", boxShadow: `0 0 4px ${status === "forging" ? "#d29922" : "#3fb950"}` }} />
            {status === "forging" ? "Forging" : "Ready"}
          </span>
        </div>
      </div>
    </div>
  );
}
