"use client";

import { X, Loader2 } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { ActionResult } from "./useJarvisActions";

interface JarvisActionPanelProps {
  loading: string | null;
  result: ActionResult | null;
  error: string | null;
  onClear: () => void;
}

export function JarvisActionPanel({ loading, result, error, onClear }: JarvisActionPanelProps) {
  const { resolvedColors: T } = useTheme();
  if (!loading && !result && !error) return null;

  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        backgroundColor: T.boxBg,
        borderColor: error ? "rgba(248,81,73,0.3)" : result?.type === "success" ? "rgba(86,211,100,0.3)" : T.borderColor + "20",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: T.headerColor }}>
          {loading ? "Running..." : error ? "Error" : result?.title || "Result"}
        </h3>
        {!loading && (
          <button onClick={onClear} className="rounded-lg p-1 transition hover:bg-white/10" style={{ color: T.textMuted }}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm" style={{ color: T.textMuted }}>
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: T.accentColor }} />
          Executing {loading}...
        </div>
      )}

      {error && (
        <div className="text-sm" style={{ color: "#f85149" }}>
          {error}
        </div>
      )}

      {!loading && result && (
        <div className="text-sm leading-relaxed" style={{ color: T.textColor }}>
          {result.content}
        </div>
      )}
    </div>
  );
}
