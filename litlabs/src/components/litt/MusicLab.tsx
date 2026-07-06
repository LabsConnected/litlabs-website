"use client";

import { useState } from "react";
import { LITT } from "./litt-theme";

interface MusicLabProps {
  onSendToLiTT?: (prompt: string) => void;
}

export function MusicLab({ onSendToLiTT }: MusicLabProps) {
  const [vibe, setVibe] = useState("cyberpunk");
  const [tempo, setTempo] = useState(120);
  const [notes, setNotes] = useState("");

  const vibePrompts: Record<string, string> = {
    cyberpunk: "dark synthwave, neon city, 808s, arpeggios",
    lofi: "chill beats, vinyl crackle, jazz chords, soft drums",
    hyperpop: "glitchy, bright, distorted, high energy",
    ambient: "pads, reverb, slow, spacey, dreamy",
  };

  const handleAskLiTT = () => {
    const prompt = `Music idea for a ${vibe} vibe at ${tempo} BPM. Notes: ${notes || "no extra notes"}. Suggest instruments, key, and a 4-bar hook.`;
    onSendToLiTT?.(prompt);
  };

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: LITT.border, backgroundColor: LITT.bgPanel }}
    >
      <h3 className="mb-1 text-lg font-bold" style={{ color: LITT.text }}>
        Music Lab
      </h3>
      <p className="mb-4 text-sm" style={{ color: LITT.textMuted }}>
        Generate a music concept and send it to LiTT for feedback.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        {Object.keys(vibePrompts).map((v) => (
          <button
            key={v}
            onClick={() => setVibe(v)}
            className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            style={{
              borderColor: vibe === v ? LITT.accentCyan : LITT.border,
              backgroundColor: vibe === v ? "rgba(163,245,70,0.12)" : LITT.bg,
              color: vibe === v ? LITT.accentCyan : LITT.textMuted,
            }}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <label
          className="mb-1 block text-xs font-semibold uppercase"
          style={{ color: LITT.textDim }}
        >
          Tempo: {tempo} BPM
        </label>
        <input
          type="range"
          min="60"
          max="180"
          value={tempo}
          onChange={(e) => setTempo(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Extra notes: mood, instruments, reference track..."
        className="mb-4 min-h-[80px] w-full rounded-lg border p-3 text-sm outline-none"
        style={{
          backgroundColor: LITT.bg,
          borderColor: LITT.border,
          color: LITT.text,
        }}
      />

      <button
        onClick={handleAskLiTT}
        disabled={!onSendToLiTT}
        className="w-full rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
        style={{ backgroundColor: LITT.accentOrange, color: "#000" }}
      >
        Ask LiTT for a music idea
      </button>
    </div>
  );
}
