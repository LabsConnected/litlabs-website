"use client";

import { useEffect, useState, useCallback } from "react";
import CameraSession from "../components/CameraSession";
import { useTheme } from "@/context/ThemeContext";
import { Sparkles, Save, Trash2, Loader2 } from "lucide-react";

export default function CameraTool() {
  const { resolvedColors: T } = useTheme();
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [visionResult, setVisionResult] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      setSnapshot(null);
    };
  }, []);

  const handleSnapshot = useCallback((dataUrl: string) => {
    setSnapshot(dataUrl);
    setVisionResult(null);
    setVisionError(null);
  }, []);

  const askLiTT = useCallback(async () => {
    if (!snapshot) return;
    setAnalyzing(true);
    setVisionError(null);
    try {
      const base64 = snapshot.split(",")[1];
      const mimeType = snapshot.match(/^data:([a-zA-Z0-9+\/\-._]+);/)?.[1] || "image/jpeg";
      const response = await fetch("/api/media/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBytes: base64,
          mimeType,
          prompt: "You are LiTT looking at an explicitly shared camera frame. Briefly describe what you see, identify anything relevant to the user's current project, and suggest one next action. Use at most three short sentences.",
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Vision analysis failed");
      }
      const data = await response.json();
      setVisionResult(data.text || "I can see the frame, but there is not enough detail to act on yet.");
    } catch (err) {
      setVisionError(err instanceof Error ? err.message : "Vision analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [snapshot]);

  const saveToAssets = useCallback(() => {
    if (!snapshot) return;
    try {
      const saved = JSON.parse(localStorage.getItem("littree:camera-snapshots") || "[]");
      saved.unshift({ dataUrl: snapshot, createdAt: Date.now() });
      localStorage.setItem("littree:camera-snapshots", JSON.stringify(saved.slice(0, 20)));
    } catch {
      // ignore
    }
  }, [snapshot]);

  const clearSnapshot = useCallback(() => {
    setSnapshot(null);
    setVisionResult(null);
    setVisionError(null);
  }, []);

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
      <CameraSession
        modelName="Gemini 2.5 Flash Vision"
        onSnapshot={handleSnapshot}
        onClose={clearSnapshot}
      />

      {snapshot && (
        <div className="shrink-0 border-t border-white/10 p-2 space-y-2">
          <div className="relative rounded-xl overflow-hidden border border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={snapshot} alt="Camera snapshot" className="w-full" />
          </div>

          {visionResult && (
            <div
              className="rounded-xl border p-3 text-xs"
              style={{
                borderColor: T.accentColor + "30",
                background: T.accentColor + "08",
                color: T.textColor,
              }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={12} style={{ color: T.accentColor }} />
                <span className="font-bold text-[10px] uppercase tracking-wider" style={{ color: T.accentColor }}>
                  LiTT Vision
                </span>
              </div>
              <p style={{ color: T.textColor }}>{visionResult}</p>
            </div>
          )}

          {visionError && (
            <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">
              {visionError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={askLiTT}
              disabled={analyzing}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition-all disabled:opacity-40"
              style={{
                background: T.accentColor + "20",
                color: T.accentColor,
                border: `1px solid ${T.accentColor}30`,
              }}
            >
              {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Ask LiTT what it sees
            </button>
            <button
              onClick={saveToAssets}
              className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/10"
            >
              <Save size={12} /> Save
            </button>
            <button
              onClick={clearSnapshot}
              className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/10"
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
