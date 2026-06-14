"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Play, Plus, Trash2, Save, Download, RefreshCw, Loader2,
  Sparkles, Film, Image as ImageIcon, AlertTriangle, CheckCircle2,
  Coins, History, Zap, GitBranch
} from "lucide-react";
import { MEDIA_PROVIDERS, MediaFormat, MediaProviderId, getProvider } from "@/lib/media";

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
};

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

const STORAGE_KEY = "litlabs-flow-history";
const MAX_CELLS = 12;
const MAX_HISTORY = 8;

export default function FlowTool() {
  const { resolvedColors: T } = useTheme();
  const [cells, setCells] = useState<FlowCell[]>(() => [newCell(0), newCell(1), newCell(2)]);
  const [flowName, setFlowName] = useState("Untitled Flow");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<FlowCellResult[]>([]);
  const [history, setHistory] = useState<{ id: string; name: string; status: string; totalCost: number; createdAt: number }[]>([]);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setHistory(JSON.parse(raw)); } catch { }
    // Read litcoins from localStorage first (consistent with Navbar)
    try {
      const coinsRaw = localStorage.getItem("litcoins");
      if (coinsRaw) {
        const val = Number(coinsRaw);
        if (!isNaN(val)) setCoinBalance(val);
      }
    } catch { }
    // Then sync from API
    fetch("/api/wallet").then(r => r.json()).then(d => { 
      if (typeof d.balance === "number") {
        setCoinBalance(d.balance);
        try { localStorage.setItem("litcoins", String(d.balance)); } catch {}
      }
    }).catch(() => {});
  }, []);

  const cellCosts = useMemo(() => cells.map(c => {
    const p = getProvider(c.providerId);
    return p ? p.cost(c.format) : 0;
  }), [cells]);

  const totalCost = cellCosts.reduce((a, b) => a + b, 0);
  const canAfford = coinBalance === null || coinBalance >= totalCost;
  const validCells = cells.filter(c => c.prompt.trim().length >= 3);
  const canRun = validCells.length > 0 && canAfford && !running;

  const addCell = useCallback(() => { setCells(prev => prev.length >= MAX_CELLS ? prev : [...prev, newCell(prev.length)]); }, []);
  const removeCell = useCallback((id: string) => { setCells(prev => prev.length <= 1 ? prev : prev.filter(c => c.id !== id)); }, []);
  const updateCell = useCallback((id: string, patch: Partial<FlowCell>) => { setCells(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)); }, []);

  const handleRun = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResults(cells.map(c => ({
      cellId: c.id,
      status: "pending" as const,
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
      setResults(data.run.results);
      setHistory(prev => [{ id: data.run.id, name: flowName, status: data.run.status, totalCost: data.run.totalCost, createdAt: Date.now() }, ...prev].slice(0, MAX_HISTORY));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: data.run.id, name: flowName, status: data.run.status, totalCost: data.run.totalCost, createdAt: Date.now() }, ...history].slice(0, MAX_HISTORY)));
      fetch("/api/wallet").then(r => r.json()).then(d => { if (typeof d.balance === "number") setCoinBalance(d.balance); }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flow run failed");
    } finally {
      setRunning(false);
    }
  }, [canRun, cells, cellCosts, flowName]);

  const clearHistory = () => { setHistory([]); localStorage.removeItem(STORAGE_KEY); };

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={14} style={{ color: T.accentColor }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Flow Orchestrator</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border" style={{ borderColor: T.borderColor, color: T.accentColor, backgroundColor: T.boxBg }}>
            <Coins size={10} /> {coinBalance ?? "—"}
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border" style={{ borderColor: T.borderColor, color: T.textColor, backgroundColor: T.boxBg }}>
            <Sparkles size={10} /> {totalCost} 🪙
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={flowName} onChange={e => setFlowName(e.target.value)} placeholder="Flow name..."
          className="flex-1 min-w-[180px] px-3 py-2 text-sm rounded outline-none"
          style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
        <button onClick={addCell} disabled={cells.length >= MAX_CELLS || running}
          className="px-3 py-2 text-xs font-bold rounded border flex items-center gap-1 disabled:opacity-40"
          style={{ borderColor: T.borderColor, color: T.textColor, backgroundColor: T.boxBg }}>
          <Plus size={12} /> Add Cell
        </button>
        <button onClick={handleRun} disabled={!canRun}
          className="px-5 py-2 text-sm font-black uppercase tracking-wider rounded flex items-center gap-2 disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`, color: T.bgColor }}>
          {running ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run ({totalCost} 🪙)</>}
        </button>
      </div>

      {error && (
        <div className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>
          <AlertTriangle size={12} /><span>{error}</span>
        </div>
      )}

      {/* Cells Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {cells.map((cell, idx) => {
          const result = results.find(r => r.cellId === cell.id);
          const cost = cellCosts[idx];
          const status = result?.status ?? "idle";
          return (
            <div key={cell.id} className="border-2 rounded-lg overflow-hidden flex flex-col"
              style={{
                borderColor: status === "running" ? T.accentColor : status === "succeeded" ? "#56d364" : status === "failed" ? "#f85149" : T.borderColor,
                backgroundColor: T.boxBg,
              }}>
              {/* Cell header */}
              <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: T.accentColor + "30", color: T.accentColor }}>{idx + 1}</span>
                  <input value={cell.label} onChange={e => updateCell(cell.id, { label: e.target.value })} disabled={running}
                    className="flex-1 min-w-0 bg-transparent text-xs font-bold outline-none" style={{ color: T.headerColor }} />
                </div>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: T.textMuted }}>
                  <span>{cost === 0 ? "FREE" : `${cost} 🪙`}</span>
                  {status === "running" && <Loader2 size={10} className="animate-spin" />}
                  {status === "succeeded" && <CheckCircle2 size={10} style={{ color: "#56d364" }} />}
                  {status === "failed" && <AlertTriangle size={10} style={{ color: "#f85149" }} />}
                </div>
              </div>

              {/* Format + Provider */}
              <div className="px-3 py-2 grid grid-cols-2 gap-2 border-b" style={{ borderColor: T.borderColor }}>
                <div>
                  <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.textMuted }}>Format</label>
                  <select value={cell.format} onChange={e => updateCell(cell.id, { format: e.target.value as MediaFormat })} disabled={running}
                    className="w-full px-2 py-1 text-xs rounded outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}>
                    <option value="image">🖼 Image</option>
                    <option value="video">🎬 Video</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-widest mb-1" style={{ color: T.textMuted }}>Provider</label>
                  <select value={cell.providerId} onChange={e => updateCell(cell.id, { providerId: e.target.value as MediaProviderId })} disabled={running}
                    className="w-full px-2 py-1 text-xs rounded outline-none" style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }}>
                    {MEDIA_PROVIDERS.filter(p => p.supportedFormats.includes(cell.format)).map(p => (
                      <option key={p.id} value={p.id}>{p.free ? "🆓 " : ""}{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Prompt */}
              <div className="px-3 py-2 flex-1 flex flex-col gap-2">
                <textarea value={cell.prompt} onChange={e => updateCell(cell.id, { prompt: e.target.value })}
                  placeholder={cell.format === "video" ? "Describe the motion..." : "Describe the scene..."}
                  rows={3} disabled={running} className="w-full px-2 py-1.5 text-xs rounded outline-none resize-none disabled:opacity-50"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
                <input value={cell.negativePrompt} onChange={e => updateCell(cell.id, { negativePrompt: e.target.value })}
                  placeholder="Negative prompt (optional)" disabled={running}
                  className="w-full px-2 py-1 text-[11px] rounded outline-none disabled:opacity-50"
                  style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
              </div>

              {/* Output */}
              {result?.downloadUrl && (
                <div className="border-t" style={{ borderColor: T.borderColor }}>
                  {result.format === "video" ? (
                    <video src={result.downloadUrl} controls className="w-full" style={{ maxHeight: "140px", backgroundColor: "#000" }} />
                  ) : (
                    <img src={result.downloadUrl} alt={cell.label} className="w-full object-cover" style={{ maxHeight: "140px" }} />
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="px-3 py-2 border-t flex items-center justify-end" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                <button onClick={() => removeCell(cell.id)} disabled={cells.length <= 1 || running}
                  className="text-[10px] opacity-60 hover:opacity-100 disabled:opacity-20 flex items-center gap-1">
                  <Trash2 size={10} /> Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
          <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.borderColor }}>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>
              <History size={10} /> Recent Flows ({history.length})
            </div>
            <button onClick={clearHistory} className="text-[9px] opacity-60 hover:opacity-100">Clear</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-2">
            {history.map(h => (
              <div key={h.id} className="relative aspect-video border rounded overflow-hidden" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                <div className="w-full h-full flex items-center justify-center text-2xl opacity-30"><Film size={20} /></div>
                <div className="absolute inset-x-0 bottom-0 px-2 py-1 text-[9px] flex items-center justify-between" style={{ backgroundColor: "rgba(0,0,0,0.8)", color: "white" }}>
                  <span className="truncate">{h.name}</span>
                  <span style={{ color: h.status === "completed" ? "#56d364" : h.status === "partial" ? T.accentColor : "#f85149" }}>{h.totalCost}🪙</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

