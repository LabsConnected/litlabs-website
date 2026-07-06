"use client";

import { useState } from "react";
import { LITT } from "./litt-theme";

interface SpecSheetsProps {
  onSendToLiTT?: (prompt: string) => void;
}

export function SpecSheets({ onSendToLiTT }: SpecSheetsProps) {
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("playful");

  const tones = ["playful", "professional", "bold", "minimal"];

  const handleAskLiTT = () => {
    const prompt = `Help me plan a website or landing page. Goal: ${goal}. Audience: ${audience || "general"}. Tone: ${tone}. Give me a structure, copy suggestions, and a CTA.`;
    onSendToLiTT?.(prompt);
  };

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: LITT.border, backgroundColor: LITT.bgPanel }}
    >
      <h3 className="mb-1 text-lg font-bold" style={{ color: LITT.text }}>
        Spec Sheets
      </h3>
      <p className="mb-4 text-sm" style={{ color: LITT.textMuted }}>
        Plan a site or page with LiTT as your copy + structure partner.
      </p>

      <input
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="Site goal (e.g., sell a course, collect emails)"
        className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{
          backgroundColor: LITT.bg,
          borderColor: LITT.border,
          color: LITT.text,
        }}
      />

      <input
        value={audience}
        onChange={(e) => setAudience(e.target.value)}
        placeholder="Target audience"
        className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{
          backgroundColor: LITT.bg,
          borderColor: LITT.border,
          color: LITT.text,
        }}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tones.map((t) => (
          <button
            key={t}
            onClick={() => setTone(t)}
            className="rounded-md border px-3 py-1 text-xs font-medium"
            style={{
              borderColor: tone === t ? LITT.accentCyan : LITT.border,
              backgroundColor: tone === t ? "rgba(163,245,70,0.12)" : LITT.bg,
              color: tone === t ? LITT.accentCyan : LITT.textMuted,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <button
        onClick={handleAskLiTT}
        disabled={!onSendToLiTT || !goal.trim()}
        className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
        style={{ backgroundColor: LITT.accentOrange, color: "#000" }}
      >
        Build spec with LiTT
      </button>
    </div>
  );
}
