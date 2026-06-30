"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { Mic, Music, Coins, Loader2, Play, Download, AlertCircle } from "lucide-react";

type Tab = "tts" | "music";

interface GeneratedResult {
  url: string;
  type: Tab;
  label: string;
  createdAt: string;
}

const COIN_COST: Record<Tab, number> = { tts: 2, music: 20 };

export default function AudioTool() {
  const { resolvedColors: T } = useTheme();
  const { balance } = useWallet();
  const [tab, setTab] = useState<Tab>("tts");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedResult[]>([]);

  const [ttsText, setTtsText] = useState("");
  const [ttsVoice, setTtsVoice] = useState("Kore");

  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicLyrics, setMusicLyrics] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(true);

  const handleGenerate = async () => {
    setError(null);
    setLoading(true);
    try {
      if (tab === "tts") {
        if (!ttsText.trim()) throw new Error("Enter text to convert.");
        const res = await fetch("/api/media/generate-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: ttsText, voice: ttsVoice }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "TTS generation failed.");
        const audioUrl = data.audioBase64 as string;
        if (!audioUrl) throw new Error("No audio returned from TTS.");
        setResults((prev) => [
          { url: audioUrl, type: "tts", label: ttsText.slice(0, 40), createdAt: new Date().toISOString() },
          ...prev.slice(0, 9),
        ]);
      } else {
        if (!musicPrompt.trim()) throw new Error("Enter a music prompt.");
        const res = await fetch("/api/music/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: musicPrompt,
            lyrics: musicLyrics || undefined,
            isInstrumental,
            model: "music-2.6-free",
            outputFormat: "url",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Music generation failed.");
        const audioUrl: string = data.audio?.url ?? data.audio ?? "";
        if (!audioUrl) throw new Error("No audio returned from music gen.");
        setResults((prev) => [
          { url: audioUrl, type: "music", label: musicPrompt.slice(0, 40), createdAt: new Date().toISOString() },
          ...prev.slice(0, 9),
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const accent = tab === "tts" ? "#00f0ff" : "#ff00a0";

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${accent}20`, backgroundColor: `${T.boxBg}80` }}
    >
      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: `${T.borderColor}20` }}>
        {(["tts", "music"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setError(null); }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all"
            style={{
              backgroundColor: tab === t ? `${accent}12` : "transparent",
              color: tab === t ? accent : T.textMuted,
              borderBottom: tab === t ? `2px solid ${accent}` : "2px solid transparent",
            }}
          >
            {t === "tts" ? <Mic size={13} /> : <Music size={13} />}
            {t === "tts" ? "Text-to-Speech" : "Music Gen"}
            <span
              className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-black"
              style={{ backgroundColor: `${accent}20`, color: accent }}
            >
              <Coins size={8} className="inline mr-0.5" />{COIN_COST[t]}
            </span>
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {tab === "tts" ? (
          <>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: T.textMuted }}>
                Text
              </label>
              <textarea
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Enter text to convert to speech…"
                className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none transition-all"
                style={{
                  backgroundColor: `${T.bgColor}80`,
                  border: `1px solid ${T.borderColor}30`,
                  color: T.textColor,
                }}
              />
              <div className="text-[9px] text-right mt-0.5" style={{ color: T.textMuted }}>
                {ttsText.length}/500
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: T.textMuted }}>
                Voice
              </label>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: `${T.bgColor}80`,
                  border: `1px solid ${T.borderColor}30`,
                  color: T.textColor,
                }}
              >
                <option value="Kore">Kore (Firm, Female)</option>
                <option value="Charon">Charon (Informational, Male)</option>
                <option value="Fenrir">Fenrir (Excitable, Male)</option>
                <option value="Aoede">Aoede (Breezy, Female)</option>
                <option value="Puck">Puck (Upbeat, Male)</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: T.textMuted }}>
                Music Prompt
              </label>
              <textarea
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Describe the music you want to create…"
                className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{
                  backgroundColor: `${T.bgColor}80`,
                  border: `1px solid ${T.borderColor}30`,
                  color: T.textColor,
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer gap-2">
                <input
                  type="checkbox"
                  checked={isInstrumental}
                  onChange={(e) => setIsInstrumental(e.target.checked)}
                  className="sr-only peer"
                />
                <div
                  className="w-8 h-4 rounded-full transition-all peer-checked:opacity-100 opacity-40"
                  style={{ backgroundColor: accent }}
                />
                <span className="text-xs font-bold" style={{ color: T.textMuted }}>Instrumental</span>
              </label>
            </div>
            {!isInstrumental && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest mb-1 block" style={{ color: T.textMuted }}>
                  Lyrics (optional)
                </label>
                <textarea
                  value={musicLyrics}
                  onChange={(e) => setMusicLyrics(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Add your own lyrics…"
                  className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{
                    backgroundColor: `${T.bgColor}80`,
                    border: `1px solid ${T.borderColor}30`,
                    color: T.textColor,
                  }}
                />
              </div>
            )}
          </>
        )}

        {/* Error */}
        {error && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ backgroundColor: "#ff000015", border: "1px solid #ff000030", color: "#ff6666" }}
          >
            <AlertCircle size={13} />
            {error}
          </div>
        )}

        {/* Balance + insufficient warning */}
        <div className="flex items-center justify-between text-[10px]" style={{ color: T.textMuted }}>
          <span className="flex items-center gap-1">
            <Coins size={10} style={{ color: T.accentColor }} />
            <span style={{ color: T.accentColor }} className="font-bold">{balance.toLocaleString()}</span> coins available
          </span>
          {balance < COIN_COST[tab] && (
            <span className="text-yellow-400 font-bold">Insufficient coins</span>
          )}
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={loading || balance < COIN_COST[tab]}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: accent,
            color: "#000",
            boxShadow: `0 0 20px ${accent}40`,
          }}
        >
          {loading ? (
            <><Loader2 size={15} className="animate-spin" /> Generating…</>
          ) : (
            <><Music size={15} /> Generate · <Coins size={12} />{COIN_COST[tab]} coins</>
          )}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="border-t px-5 pb-5 space-y-3" style={{ borderColor: `${T.borderColor}20` }}>
          <div className="text-[10px] font-bold uppercase tracking-widest pt-4" style={{ color: T.textMuted }}>
            Recent Generations
          </div>
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ backgroundColor: `${T.bgColor}60`, border: `1px solid ${T.borderColor}15` }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${r.type === "tts" ? "#00f0ff" : "#ff00a0"}15` }}
              >
                {r.type === "tts" ? <Mic size={14} style={{ color: "#00f0ff" }} /> : <Music size={14} style={{ color: "#ff00a0" }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>{r.label}</div>
                <div className="text-[9px]" style={{ color: T.textMuted }}>{new Date(r.createdAt).toLocaleTimeString()}</div>
              </div>
              <div className="flex items-center gap-1">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:opacity-70" style={{ color: T.textMuted }}>
                  <Play size={13} />
                </a>
                <a href={r.url} download className="p-1.5 rounded-lg hover:opacity-70" style={{ color: T.textMuted }}>
                  <Download size={13} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
