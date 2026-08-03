"use client";

import { useMemo } from "react";
import LiTTPresence from "./LiTTPresence";
import type { LiTTState } from "./LiTTPresence";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";

/**
 * StudioFloatingPresence — a small, persistent LiTT head that never
 * disappears from the Studio. Its expression is driven by REAL state:
 * the conversation busy flag + the voice session state. No fake activity.
 *
 * States (mapped from voice + busy):
 *   listening  — microphone capturing
 *   thinking   — voice transcribing/thinking
 *   working    — agent turn in flight (busy) or voice speaking
 *   error      — voice error
 *   idle       — nothing happening
 *
 * Clicking it opens the Activity drawer (passed via onOpenActivity).
 * Respects prefers-reduced-motion via LiTTPresence.
 */
const STATE_LABEL: Record<LiTTState, string> = {
  idle: "LiTT idle",
  listening: "LiTT listening",
  thinking: "LiTT thinking",
  working: "LiTT working",
  success: "LiTT done",
  error: "LiTT error",
};

export default function StudioFloatingPresence({
  busy = false,
  onOpenActivity,
}: {
  busy?: boolean;
  onOpenActivity?: () => void;
}) {
  const voiceState = useVoiceStore((s) => s.state);

  const liTTState: LiTTState = useMemo(() => {
    if (voiceState === "error") return "error";
    if (voiceState === "listening") return "listening";
    if (voiceState === "transcribing" || voiceState === "thinking") return "thinking";
    if (voiceState === "speaking" || voiceState === "connecting") return "working";
    if (busy) return "working";
    return "idle";
  }, [voiceState, busy]);

  return (
    <button
      type="button"
      onClick={onOpenActivity}
      className="group fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border px-2.5 py-2 transition-all hover:scale-105 hover:bg-white/5"
      style={{
        borderColor: "var(--studio-border-strong)",
        backgroundColor: "var(--studio-bg)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      }}
      aria-label={STATE_LABEL[liTTState]}
      title={STATE_LABEL[liTTState]}
      data-testid="studio-floating-presence"
    >
      <LiTTPresence state={liTTState} variant="terminal" size="sm" />
      <span
        className="hidden text-[10px] font-bold uppercase tracking-wider sm:inline"
        style={{ color: "var(--text-secondary)" }}
      >
        {liTTState}
      </span>
    </button>
  );
}
