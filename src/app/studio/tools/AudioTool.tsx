"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Music, Wand2, Download, AlertTriangle, Loader2, History, Sparkles, Play, Pause, Mic, Volume2
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
  { id: "elevenmusic", label: "ElevenMusic", desc: "Full music generation", cost: 2 },
  { id: "ace", label: "AceStep", desc: "Electronic beats", cost: 1 },
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
  const [mode, setMode] = useState<"tts" | "music">("tts");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("nova");
  const [musicModel, setMusicModel] = useState("elevenmusic");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<AudioGen | null>(null);
  const [history, setHistory] = useState<AudioGen[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cost = mode === "tts" ? 1 : (MUSIC_MODELS.find(m => m.id === musicModel)?.cost || 2);
  const canAfford = coinBalance === null || coinBalance >= cost;

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

  useEffect(() => { if (history.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); }, [history]);

  const handleGenerate = useCallback(async () => {
    if (!text.trim() || text.trim().length < 3) { setError("Text must be at least 3 characters."); return; }
    if (!canAfford) { setError(`Need ${cost} LiTBit Coins.`); return; }
    setError(null);
    setIsGenerating(true);
    const id = `aud_${Date.now()}`;
    const gen: AudioGen = { id, text: text.trim(), voice: mode === "tts" ? voice : undefined, model: mode === "music" ? musicModel : undefined, mode, status: "generating", createdAt: Date.now(), cost };
    setCurrent(gen);
    setHistory(prev => [gen, ...prev].slice(0, MAX_HISTORY));

    try {
      const encoded = encodeURIComponent(text.trim());
      const url = mode === "tts"
        ? `https://gen.pollinations.ai/audio/${encoded}?voice=${voice}`
        : `https://gen.pollinations.ai/audio/${encoded}?model=${musicModel}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      setCurrent(prev => prev?.id === id ? { ...prev, status: "succeeded", audioUrl } : prev);
      setHistory(prev => prev.map(g => g.id === id ? { ...g, status: "succeeded", audioUrl } : g));
      const wres = await fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "spend", amount: cost, reason: `audio_${mode}` }) });
      const wdata = await wres.json();
      if (typeof wdata.balance === "number") setCoinBalance(wdata.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audio generation failed");
      setCurrent(prev => prev?.id === id ? { ...prev, status: "failed", error: err instanceof Error ? err.message : "failed" } : prev);
      setHistory(prev => prev.map(g => g.id === id ? { ...g, status: "failed", error: err instanceof Error ? err.message : "failed" } : g));
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
    const a = document.createElement("a");
    a.href = url;
    a.download = `litbit-${label}-${Date.now()}.mp3`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleClear = () => { setHistory([]); localStorage.removeItem(STORAGE_KEY); };

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={14} style={{ color: T.accentColor }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Audio Generator</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border" style={{ borderColor: T.borderColor, color: T.accentColor, backgroundColor: T.boxBg }}>
          <Sparkles size={10} /> {coinBalance ?? "—"} LiTBit
        </div>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-1">
        {([
          { id: "tts" as const, label: "Text to Speech", icon: Mic },
          { id: "music" as const, label: "Music / Sound", icon: Volume2 },
        ]).map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold rounded border transition-all"
            style={{ backgroundColor: mode === m.id ? T.accentColor + "20" : T.bgColor, borderColor: mode === m.id ? T.accentColor : T.borderColor, color: mode === m.id ? T.accentColor : T.textColor }}>
            <m.icon size={12} />{m.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* LEFT: Controls */}
        <div className="lg:col-span-2 space-y-3">
          <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: T.textMuted }}>
              {mode === "tts" ? "Text to Speak" : "Music Prompt"}
            </label>
            <textarea value={text} onChange={e => { setText(e.target.value); setError(null); }}
              placeholder={mode === "tts" ? "Hello world, this is a test of text-to-speech..." : "Upbeat electronic dance track with heavy bass drops..."}
              rows={5} disabled={isGenerating}
              className="w-full px-3 py-2 text-sm rounded outline-none resize-none disabled:opacity-50"
              style={{ backgroundColor: T.bgColor, border: `1px solid ${T.borderColor}`, color: T.textColor }} />
            <div className="text-right text-[10px] mt-1" style={{ color: T.textMuted }}>{text.length} chars</div>
          </div>

          {mode === "tts" ? (
            <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Voice</label>
              <div className="grid grid-cols-2 gap-1.5">
                {VOICES.map(v => (
                  <button key={v.id} onClick={() => setVoice(v.id)} disabled={isGenerating}
                    className="p-2 text-left text-[11px] rounded border transition-all hover:scale-[1.01] disabled:opacity-50"
                    style={{ backgroundColor: voice === v.id ? T.accentColor + "20" : T.bgColor, borderColor: voice === v.id ? T.accentColor : T.borderColor, color: voice === v.id ? T.accentColor : T.textColor }}>
                    <div className="font-bold">{v.label}</div>
                    <div className="text-[9px] opacity-60">{v.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="border rounded-lg p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <label className="block text-[10px] uppercase tracking-widest mb-2" style={{ color: T.textMuted }}>Model</label>
              <div className="space-y-1.5">
                {MUSIC_MODELS.map(m => (
                  <button key={m.id} onClick={() => setMusicModel(m.id)} disabled={isGenerating}
                    className="w-full p-2 text-left text-[11px] rounded border transition-all hover:scale-[1.01] disabled:opacity-50"
                    style={{ backgroundColor: musicModel === m.id ? T.accentColor + "20" : T.bgColor, borderColor: musicModel === m.id ? T.accentColor : T.borderColor, color: musicModel === m.id ? T.accentColor : T.textColor }}>
                    <div className="font-bold flex items-center justify-between"><span>{m.label}</span><span className="text-[9px] opacity-60">{m.cost} 🪙</span></div>
                    <div className="text-[9px] opacity-60 mt-0.5">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button onClick={handleGenerate} disabled={!text.trim() || !canAfford || isGenerating}
            className="w-full py-3 rounded-lg font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 transition-all hover:scale-[1.01]"
            style={{ background: `linear-gradient(135deg, ${T.accentColor} 0%, ${T.headerColor} 100%)`, color: T.bgColor, boxShadow: `0 0 20px ${T.accentColor}30` }}>
            {isGenerating ? <><Loader2 size={16} className="animate-spin" /> Generating...</>
              : <><Wand2 size={16} /> Generate ({cost} 🪙)</>}
          </button>

          {error && (
            <div className="text-[11px] flex items-center gap-1.5 px-3 py-2 rounded border" style={{ borderColor: "#f85149", color: "#f85149", backgroundColor: "#f8514910" }}>
              <AlertTriangle size={12} /><span>{error}</span>
            </div>
          )}
        </div>

        {/* RIGHT: Player + History */}
        <div className="lg:col-span-3 space-y-3">
          <div className="border-2 rounded-lg overflow-hidden" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="px-3 py-1.5 border-b flex items-center justify-between" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
              <span className="text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>Player</span>
            </div>
            <div className="aspect-[3/1] relative flex items-center justify-center" style={{ backgroundColor: T.bgColor }}>
              {current?.audioUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <button onClick={() => togglePlay(current.id, current.audioUrl!)}
                    className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110"
                    style={{ backgroundColor: T.accentColor + "20", border: `2px solid ${T.accentColor}` }}>
                    {playingId === current.id ? <Pause size={24} style={{ color: T.accentColor }} /> : <Play size={24} style={{ color: T.accentColor }} />}
                  </button>
                  <div className="text-[10px] opacity-60" style={{ color: T.textMuted }}>
                    {current.mode === "tts" ? `Voice: ${current.voice}` : `Model: ${current.model}`} · {current.cost} 🪙
                  </div>
                </div>
              ) : isGenerating ? (
                <div className="text-center">
                  <Loader2 size={28} className="animate-spin mx-auto mb-2" style={{ color: T.accentColor }} />
                  <p className="text-sm opacity-70">Generating audio...</p>
                </div>
              ) : (
                <div className="text-center px-6">
                  <div className="text-4xl mb-2 opacity-30">🎵</div>
                  <p className="text-sm opacity-60">Your audio will appear here</p>
                </div>
              )}
            </div>
            {current?.audioUrl && (
              <div className="px-3 py-2 border-t flex items-center gap-2" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                <button onClick={() => handleDownload(current.audioUrl!, current.mode)}
                  className="px-2.5 py-1 text-[10px] font-bold rounded border flex items-center gap-1" style={{ borderColor: T.borderColor, color: T.textColor }}>
                  <Download size={10} /> Download
                </button>
              </div>
            )}
          </div>

          <div className="border rounded-lg" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.borderColor }}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest" style={{ color: T.textMuted }}>
                <History size={10} /> Recent ({history.length})
              </div>
              {history.length > 0 && <button onClick={handleClear} className="text-[9px] opacity-60 hover:opacity-100">Clear</button>}
            </div>
            {history.length === 0 ? (
              <div className="p-6 text-center text-xs opacity-50">No audio yet.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: T.borderColor + "20" }}>
                {history.map(g => (
                  <div key={g.id} className="flex items-center gap-3 px-3 py-2 hover:opacity-80 transition-opacity">
                    <button onClick={() => g.audioUrl && togglePlay(g.id, g.audioUrl)}
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: T.accentColor + "15", border: `1px solid ${T.accentColor}30` }}>
                      {playingId === g.id ? <Pause size={12} style={{ color: T.accentColor }} /> : <Play size={12} style={{ color: T.accentColor }} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate" style={{ color: T.textColor }}>{g.text}</div>
                      <div className="text-[9px] opacity-50" style={{ color: T.textMuted }}>{g.mode} · {g.voice || g.model} · {g.cost} 🪙</div>
                    </div>
                    {g.audioUrl && (
                      <button onClick={() => handleDownload(g.audioUrl!, g.mode)}
                        className="p-1 rounded opacity-40 hover:opacity-100" style={{ color: T.textColor }}>
                        <Download size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
