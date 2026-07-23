"use client";

import { useState } from "react";
import { VoiceController } from "@/features/voice/components/VoiceController";

export function FloatingVoiceButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all hover:scale-110"
        style={{
          background: "linear-gradient(135deg, #a8ff2f 0%, #22c55e 100%)",
          boxShadow: "0 0 20px rgba(168, 255, 47, 0.3)",
        }}
        aria-label="Voice"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>

      {/* Voice panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 rounded-2xl border border-white/10 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider opacity-60">LiTT Voice</span>
            <button onClick={() => setOpen(false)} className="opacity-40 hover:opacity-80">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18 M6 6l12 12" />
              </svg>
            </button>
          </div>
          <VoiceController showSelector showStatus />
        </div>
      )}
    </>
  );
}
