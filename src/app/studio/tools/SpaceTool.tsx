"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Rocket, Loader2, Sparkles } from "lucide-react";

export default function SpaceTool() {
  const { resolvedColors: T } = useTheme();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/skybox/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data.imageUrl || data.url || JSON.stringify(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Rocket size={20} style={{ color: "#ff6b35" }} />
        <span
          className="text-sm font-black uppercase tracking-widest"
          style={{ color: T.headerColor }}
        >
          Space
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-mono"
          style={{
            backgroundColor: "#ff6b3520",
            color: "#ff6b35",
            border: "1px solid #ff6b3540",
          }}
        >
          MiniMax
        </span>
      </div>

      {/* Prompt */}
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{
          backgroundColor: T.boxBg,
          border: `1px solid ${T.borderColor}20`,
        }}
      >
        <label
          className="text-xs font-bold uppercase tracking-widest opacity-60"
          style={{ color: T.textMuted }}
        >
          Prompt
        </label>
        <textarea
          id="space-tool-prompt"
          name="spaceToolPrompt"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a space scene, skybox, or 3D environment…"
          className="w-full bg-transparent resize-none text-sm outline-none placeholder:opacity-40 sm:min-h-[8rem]"
          style={{ color: T.textColor }}
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="self-end flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
          style={{
            backgroundColor: "#ff6b35",
            color: "#fff",
          }}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>

      {/* Result */}
      {error && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{
            backgroundColor: "#ff000015",
            border: "1px solid #ff000040",
            color: "#ff6b6b",
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          className="rounded-xl overflow-hidden flex flex-col gap-2"
          style={{ border: `1px solid ${T.borderColor}20` }}
        >
          {result.startsWith("http") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result}
              alt="Generated space"
              className="w-full object-cover rounded-xl"
            />
          ) : (
            <pre
              className="p-4 text-xs font-mono overflow-auto"
              style={{ color: T.textColor, backgroundColor: T.boxBg }}
            >
              {result}
            </pre>
          )}
        </div>
      )}

      {!result && !error && !loading && (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3 opacity-30"
          style={{ color: T.textMuted }}
        >
          <Rocket size={40} />
          <p className="text-sm">Generate a space scene or skybox</p>
        </div>
      )}
    </div>
  );
}
