"use client";

import { useState } from "react";
import { Mic, X, Sparkles } from "lucide-react";

type OrbState = "idle" | "thinking" | "working" | "listening" | "success";

const ORB_EMOJI: Record<OrbState, string> = {
  idle: "😊",
  thinking: "🧠",
  working: "⚡",
  listening: "🎤",
  success: "🎉",
};

const ORB_GLOW: Record<OrbState, string> = {
  idle: "shadow-[0_0_20px_rgba(34,211,238,0.4)]",
  thinking: "shadow-[0_0_30px_rgba(232,121,249,0.6)]",
  working: "shadow-[0_0_30px_rgba(251,146,60,0.6)]",
  listening: "shadow-[0_0_30px_rgba(34,211,238,0.6)]",
  success: "shadow-[0_0_30px_rgba(74,222,128,0.6)]",
};

export function FloatingOrb({ state = "idle" }: { state?: OrbState }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-64 rounded-2xl border border-cyan-500/30 bg-[#080808]/95 p-4 backdrop-blur-md shadow-[0_0_40px_rgba(34,211,238,0.15)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-black text-cyan-300">LiTT</span>
            <button
              onClick={() => setOpen(false)}
              className="text-neutral-500 hover:text-neutral-300"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-neutral-300">
            Tap the mic or type. I&apos;ll route your request to the right
            agent.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-cyan-500/15 py-1.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/25 transition">
              <Mic size={12} /> Voice
            </button>
            <button className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-neutral-800/60 py-1.5 text-[10px] font-bold text-neutral-300 hover:bg-neutral-700/60 transition">
              <Sparkles size={12} /> Chat
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-14 w-14 items-center justify-center rounded-full border border-cyan-500/40 bg-neutral-900/90 text-2xl transition-all hover:scale-110 ${ORB_GLOW[state]} animate-pulse-slow`}
        aria-label="Open LiTT"
      >
        {ORB_EMOJI[state]}
      </button>
    </div>
  );
}
