"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useAuth, RedirectToSignIn } from "@clerk/nextjs";
import {
  Play, Plus, Trash2, Save, Download, RefreshCw, Loader2,
  Sparkles, Film, Image as ImageIcon, AlertTriangle, CheckCircle2,
  Coins, History, Wand2, ArrowRight, Zap
} from "lucide-react";
import { MEDIA_PROVIDERS, MediaFormat, MediaProviderId, getProvider } from "@/lib/media";

/* ------------------------------------------------------------------ */
/*  Cell + Run types — kept simple; /api/flow is the source of truth.  */
/* ------------------------------------------------------------------ */
type FlowCell = {
  id: string;
  label: string;
  format: MediaFormat;
  providerId: MediaProviderId;
  prompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  referenceUrl?: string;
};

type FlowCellResult = {
  cellId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  downloadUrl?: string;
  thumbUrl?: string;
  providerId: MediaProviderId;
  format: MediaFormat;
  cost: number;
  error?: string;
  durationMs?: number;
};

type FlowRunRecord = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "partial";
  totalCost: number;
  cells: FlowCell[];
  results: FlowCellResult[];
  createdAt: number;
};

type Ingredient = {
  id: string;
  label: string;
  url: string;
};

const STORAGE_KEY = "litlabs-flow-history";
const INGREDIENTS_KEY = "litlabs-flow-ingredients";
const MAX_HISTORY = 8;
const MAX_CELLS = 12;

function newCell(idx: number): FlowCell {
  return {
    id: `cell_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    label: `Scene ${idx + 1}`,
    format: idx === 0 ? "image" : idx === 1 ? "video" : "image",
    providerId: idx === 0 ? "pollinations" : "huggingface",
    prompt: "",
    negativePrompt: "",
    seed: 0,
    width: 1024,
    height: 1024,
    referenceUrl: "",
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function FlowPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { resolvedColors: T } = useTheme();

  const [cells, setCells] = useState<FlowCell[]>(() => [newCell(0), newCell(1), newCell(2), newCell(3)]);
  const [flowName, setFlowName] = useState("Untitled Flow");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<FlowCellResult[]>([]);
  const [history, setHistory] = useState<FlowRunRecord[]>([]);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState(MEDIA_PROVIDERS);
  const [activeResult, setActiveResult] = useState<FlowCellResult | null>(null);
  const resultRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientLabel, setIngredientLabel] = useState("");
  const [ingredientUrl, setIngredientUrl] = useState("");

  /* ---- Persist history ---- */
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INGREDIENTS_KEY);
      if (raw) setIngredients(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(ingredients));
    } catch {
      // ignore
    }
  }, [ingredients]);

  const addIngredient = useCallback(() => {
    const label = ingredientLabel.trim();
    const url = ingredientUrl.trim();
    if (!label || !url) return;
    setIngredients(prev => [{ id: `ing_${Date.now()}`, label, url }, ...prev]);
    setIngredientLabel("");
    setIngredientUrl("");
  }, [ingredientLabel, ingredientUrl]);

  const removeIngredient = useCallback((id: string) => {
    setIngredients(prev => prev.filter(ing => ing.id !== id));
  }, []);

  /* ---- Load providers + balance ---- */
  useEffect(() => {
    fetch("/api/media/generate")
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.providers)) setProviders(d.providers);
      })
      .catch(() => { /* keep defaults */ });

    if (isSignedIn) {
      fetch("/api/wallet")
        .then(r => r.json())
        .then(d => { if (typeof d.balance === "number") setCoinBalance(d.balance); })
        .catch(() => { /* silent */ });
    }
  }, [isSignedIn]);

  /* ---- Cost calc ---- */
  const cellCosts = useMemo(() => cells.map(c => {
    const p = getProvider(c.providerId);
    if (!p) return 0;
    return p.cost(c.format);
  }), [cells]);
  const totalCost = cellCosts.reduce((a, b) => a + b, 0);
  const canAfford = coinBalance === null || coinBalance >= totalCost;
  const validCells = cells.filter(c => c.prompt.trim().length >= 3);
  const canRun = validCells.length > 0 && canAfford && !running;

  /* ---- Cell ops ---- */
  const addCell = useCallback(() => {
    setCells(prev => prev.length >= MAX_CELLS ? prev : [...prev, newCell(prev.length)]);
  }, []);

  const removeCell = useCallback((id: string) => {
    setCells(prev => prev.length <= 1 ? prev : prev.filter(c => c.id !== id));
  }, []);

  const updateCell = useCallback((id: string, patch: Partial<FlowCell>) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }, []);

  const moveCell = useCallback((id: string, dir: -1 | 1) => {
    setCells(prev => {
      const i = prev.findIndex(c => c.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  /* ---- Run flow ---- */
  const handleRun = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResults(cells.map(c => ({
      cellId: c.id,
      status: "pending",
      providerId: c.providerId,
      format: c.format,
      cost: cellCosts[cells.findIndex(x => x.id === c.id)],
    })));
    try {
      const res = await fetch("/api/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: flowName, cells }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Flow run failed");

      const run: FlowRunRecord = {
        id: data.run.id,
        name: flowName,
        status: data.run.status,
        totalCost: data.run.totalCost,
        cells: data.run.cells,
        results: data.run.results,
        createdAt: data.run.createdAt,
      };
      setResults(data.run.results);
      setHistory(prev => [run, ...prev].slice(0, MAX_HISTORY));
      // Refresh balance
      if (typeof data.run.totalCost === "number") {
        fetch("/api/wallet").then(r => r.json()).then(d => {
          if (typeof d.balance === "number") setCoinBalance(d.balance);
        }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flow run failed");
    } finally {
      setRunning(false);
    }
  }, [canRun, cells, cellCosts, flowName]);

  /* ---- Save single result to gallery ---- */
  const saveToGallery = useCallback(async (r: FlowCellResult) => {
    if (!r.downloadUrl) return;
    try {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: r.downloadUrl, caption: `${flowName} — cell ${r.cellId}` }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Save to gallery failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }, [flowName]);

  const loadHistoryEntry = useCallback((entry: FlowRunRecord) => {
    setFlowName(entry.name + " (reloaded)");
    setCells(entry.cells);
    setResults(entry.results);
  }, []);

  const handleDownload = useCallback((url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name.replace(/[^a-z0-9]+/gi, "_") + (url.startsWith("data:video") ? ".mp4" : ".jpg");
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  /* ---- Loading + auth guards ---- */
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono" style={{ backgroundColor: T.bgColor, color: T.accentColor }}>
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div>Loading Flow Studio...</div>
        </div>
      </div>
    );
  }
  if (!isSignedIn) return <RedirectToSignIn redirectUrl="/flow" />;

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor, fontFamily: "monospace" }}>
      <div className="fixed inset-0 pointer-events-none opacity-20" style={{
        backgroundImage: `linear-gradient(${T.borderColor}40 1px, transparent 1px), linear-gradient(90deg, ${T.borderColor}40 1px, transparent 1px)`,
        backgroundSize: "60px 60px",
      }} />

      {/* HERO */}
      <section className="relative border-b-2" style={{ borderColor: T.borderColor, background: `linear-gradient(180deg, ${T.boxBg} 0%, ${T.bgColor} 100%)` }}>
        <div className="max-w-7xl mx-auto px-6 py-10 md:py-14 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] uppercase tracking-widest mb-3"
            style={{ borderColor: T.accentColor + "60", color: T.accentColor, backgroundColor: T.accentColor + "10" }}>
            <Film size={12} />
            <span>Flow Media Studio · Multi-Provider · Storyboard Engine</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-2" style={{ color: T.headerColor }}>
            Chain. Blend. Ship.
          </h1>
          <p className="text-sm md:text-base max-w-2xl mx-auto opacity-70">
            Build a storyboard of scenes. Each cell picks its own provider, model, and format. Outputs chain automatically — image → video → image — and coins are deducted up front so you can budget the whole flow.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5 text-[11px]">
            <div className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <Coins size={14} style={{ color: T.accentColor }} />
              <span style={{ color: T.accentColor }}>{coinBalance ?? "—"}</span>
              <span className="opacity-60">LiTBit Coins</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <Wand2 size={14} style={{ color: T.accentColor }} />
              <span>{cells.length} cell{cells.length === 1 ? "" : "s"} · {totalCost} 🪙</span>
            </div>
            <Link href="/generate" className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg hover:opacity-80" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <ImageIcon size={14} />
              <span>Single Image Gen</span>
            </Link>
            <Link href="/builder" className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg hover:opacity-80" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <Sparkles size={14} />
              <span>Builder</span>
            </Link>
          </div>
        </div>
      </section>

      {/* CONTROLS BAR */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 pt-6 relative z-10">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            value={flowName}
            onChange={e => setFlowName(e.target.value)}
            placeholder="Flow name..."
            className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded outline-none"
            style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}`, color: T.textColor }}
          />
          <button
            onClick={addCell}
            disabled={cells.length >= MAX_CELLS || running}
            className="px-3 py-2 text-xs font-bold rounded flex items-center gap-1.5 disabled:opacity-40"
            style={{ border: `1px solid ${T.borderColor}`, color: T.textColor, backgroundColor: T.boxBg }}
          >
            <Plus size={14} /> Add Cell
          </button>
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="px-5 py-2 text-sm font-black uppercase tracking-wider rounded flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`,
              color: T.bgColor,
              boxShadow: `0 0 30px ${T.accentColor}40`,
            }}
          >
            {running ? <><Loader2 size={16} className="animate-spin" /> Running...</> : <><Play size={16} /> Run Flow ({totalCost} 🪙)</>}
          </button>
        </div>

        {!canAfford && (
          <div className="mb-4 text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>
            <AlertTriangle size={12} />
            <span>Need {totalCost - (coinBalance ?? 0)} more coins. Claim daily bonus or switch to free Pollinations.</span>
          </div>
        )}
        {error && (
          <div className="mb-4 text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>
            <AlertTriangle size={12} />
            <span>{error}</span>
          </div>
        )}
      </section>

      {/* INGREDIENTS LIBRARY */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 pb-4 relative z-10">
        <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: T.borderColor }}>
            <div className="text-[11px] uppercase tracking-widest" style={{ color: T.textMuted, display: "flex", alignItems: "center", gap: "6px" }}>
              <Sparkles size={12} /> Ingredients Library
            </div>
            <span className="text-[10px] opacity-60">Reference art stays with you</span>
          </div>
          <div className="px-4 py-3 space-y-3">
            <p className="text-[11px] opacity-70">Drop in character faces, set pieces, or compositional references to reuse across scenes. Each cell can point to one ingredient for consistent video renders.</p>
            {ingredients.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {ingredients.map(ing => (
                  <div key={ing.id} className="border rounded-lg overflow-hidden" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                    <div style={{ height: "96px", backgroundImage: `url(${ing.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                    <div className="px-3 py-2 text-[10px] flex items-center justify-between gap-2">
                      <span className="truncate" style={{ color: T.textColor }}>{ing.label}</span>
                      <button type="button" onClick={() => removeIngredient(ing.id)} className="text-[10px] opacity-60 hover:opacity-100">×</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] opacity-50">No ingredients yet. Add one to keep characters consistent.</div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.2fr_1.8fr_0.6fr]">
              <input value={ingredientLabel} onChange={e => setIngredientLabel(e.target.value)} placeholder="Label (e.g. Char face)" className="px-2 py-2 rounded text-sm outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
              <input value={ingredientUrl} onChange={e => setIngredientUrl(e.target.value)} placeholder="Image URL" className="px-2 py-2 rounded text-sm outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
              <button onClick={addIngredient} disabled={!ingredientLabel.trim() || !ingredientUrl.trim()} className="px-3 py-2 text-xs uppercase tracking-widest rounded font-bold" style={{ border: `1px solid ${T.borderColor}`, backgroundColor: T.accentColor, color: T.bgColor }}>
                Add
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* STORYBOARD CELLS */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 pb-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cells.map((cell, idx) => {
            const result = results.find(r => r.cellId === cell.id);
            const cost = cellCosts[idx];
            const provider = getProvider(cell.providerId);
            const status = result?.status ?? "idle";
            return (
              <div
                key={cell.id}
                ref={el => { resultRefs.current[cell.id] = el; }}
                className="border-2 rounded-lg overflow-hidden flex flex-col"
                style={{
                  borderColor: status === "running" ? T.accentColor
                    : status === "succeeded" ? "#56d364"
                    : status === "failed" ? "#f85149"
                    : T.borderColor,
                  backgroundColor: T.boxBg,
                }}
              >
                {/* Header */}
                <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: T.accentColor + "30", color: T.accentColor }}>
                      {idx + 1}
                    </span>
                    <input
                      value={cell.label}
                      onChange={e => updateCell(cell.id, { label: e.target.value })}
                      disabled={running}
                      className="flex-1 min-w-0 bg-transparent text-xs font-bold outline-none"
                      style={{ color: T.headerColor }}
                    />
                  </div>
                  <div className="flex items-center gap-1 text-[10px]" style={{ color: T.textMuted }}>
                    <span>{cost === 0 ? "FREE" : `${cost} 🪙`}</span>
                    {status === "running" && <Loader2 size={10} className="animate-spin" />}
                    {status === "succeeded" && <CheckCircle2 size={10} style={{ color: "#56d364" }} />}
                    {status === "failed" && <AlertTriangle size={10} style={{ color: "#f85149" }} />}
                  </div>
                </div>

                {/* Format + Provider pickers */}
                <div className="px-3 py-2 grid grid-cols-2 gap-2 border-b" style={{ borderColor: T.borderColor }}>
                  <div>
                    <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.textMuted }}>Format</label>
                    <select
                      value={cell.format}
                      onChange={e => updateCell(cell.id, { format: e.target.value as MediaFormat })}
                      disabled={running}
                      className="w-full px-2 py-1 text-xs rounded outline-none"
                      style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
                    >
                      <option value="image">🖼 Image</option>
                      <option value="video">🎬 Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.textMuted }}>Provider</label>
                    <select
                      value={cell.providerId}
                      onChange={e => updateCell(cell.id, { providerId: e.target.value as MediaProviderId })}
                      disabled={running}
                      className="w-full px-2 py-1 text-xs rounded outline-none"
                      style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
                    >
                      {providers.filter(p => p.supportedFormats.includes(cell.format)).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.free ? "🆓 " : ""}{p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Prompt */}
                <div className="px-3 py-2 flex-1 flex flex-col gap-2">
                  <textarea
                    value={cell.prompt}
                    onChange={e => updateCell(cell.id, { prompt: e.target.value })}
                    placeholder={cell.format === "video" ? "Describe the motion..." : "Describe the scene..."}
                    rows={3}
                    disabled={running}
                    className="w-full px-2 py-1.5 text-xs rounded outline-none resize-none disabled:opacity-50"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
                  />
                  {/* Negative prompt */}
                  <input
                    value={cell.negativePrompt}
                    onChange={e => updateCell(cell.id, { negativePrompt: e.target.value })}
                    placeholder="Negative prompt (optional)"
                    disabled={running}
                    className="w-full px-2 py-1 text-[11px] rounded outline-none disabled:opacity-50"
                    style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}
                  />
                </div>

                {/* Output area */}
                {result?.downloadUrl && (
                  <div className="border-t" style={{ borderColor: T.borderColor }}>
                    {result.format === "video" ? (
                      <video src={result.downloadUrl} controls className="w-full" style={{ maxHeight: "180px", backgroundColor: "#000" }} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={result.downloadUrl} alt={cell.label} className="w-full object-cover" style={{ maxHeight: "180px" }} />
                    )}
                    <div className="px-2 py-1.5 flex items-center gap-1.5">
                      <button
                        onClick={() => saveToGallery(result)}
                        className="flex-1 text-[10px] py-1 rounded font-bold flex items-center justify-center gap-1"
                        style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                      >
                        <Save size={10} /> Save
                      </button>
                      <button
                        onClick={() => handleDownload(result.downloadUrl!, `${flowName}-${idx + 1}`)}
                        className="flex-1 text-[10px] py-1 rounded border font-bold flex items-center justify-center gap-1"
                        style={{ borderColor: T.borderColor, color: T.textColor }}
                      >
                        <Download size={10} /> DL
                      </button>
                    </div>
                    {result.error && (
                      <div className="px-2 py-1 text-[10px]" style={{ color: "#f85149" }}>{result.error}</div>
                    )}
                  </div>
                )}

                {/* Footer: reorder + delete */}
                <div className="px-3 py-2 border-t flex items-center justify-between" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveCell(cell.id, -1)} disabled={idx === 0 || running} className="text-[10px] opacity-60 hover:opacity-100 disabled:opacity-20">←</button>
                    <button onClick={() => moveCell(cell.id, 1)} disabled={idx === cells.length - 1 || running} className="text-[10px] opacity-60 hover:opacity-100 disabled:opacity-20">→</button>
                  </div>
                  <button
                    onClick={() => removeCell(cell.id)}
                    disabled={cells.length <= 1 || running}
                    className="text-[10px] opacity-60 hover:opacity-100 disabled:opacity-20 flex items-center gap-1"
                  >
                    <Trash2 size={10} /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* HISTORY */}
      {history.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 md:px-6 pb-12 relative z-10">
          <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: T.borderColor }}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest" style={{ color: T.textMuted }}>
                <History size={12} />
                <span>Recent Flows ({history.length})</span>
              </div>
              <button onClick={clearHistory} className="text-[10px] opacity-60 hover:opacity-100">Clear</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3">
              {history.map(h => (
                <button
                  key={h.id}
                  onClick={() => loadHistoryEntry(h)}
                  className="relative aspect-video border rounded overflow-hidden group hover:scale-[1.02] transition-transform"
                  style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}
                >
                  {h.results.find(r => r.downloadUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={h.results.find(r => r.thumbUrl)?.thumbUrl ?? h.results.find(r => r.downloadUrl)!.downloadUrl!}
                      alt={h.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl opacity-30"><Film /></div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 px-2 py-1 text-[9px] flex items-center justify-between" style={{ backgroundColor: "rgba(0,0,0,0.8)", color: "white" }}>
                    <span className="truncate">{h.name}</span>
                    <span style={{ color: h.status === "completed" ? "#56d364" : h.status === "partial" ? T.accentColor : "#f85149" }}>{h.totalCost}🪙</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FOOTER */}
      <section className="max-w-7xl mx-auto px-6 pb-12 text-center text-[10px] opacity-50 relative z-10 flex items-center justify-center gap-2">
        <Zap size={10} /> Free default = Pollinations (no key). Paid = Together.ai + FAL.ai + HuggingFace. Run all for headless agent use.
      </section>
    </div>
  );
}
