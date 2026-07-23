"use client";

import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { AGENT_PROFILES } from "@/features/voice/lib/agentProfiles";
import type { CSSProperties } from "react";

function MicIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8" />
    </svg>
  );
}

function SquareIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function VolumeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14 M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function MicOffIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l22 22 M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23 M12 19v4 M8 23h8" />
    </svg>
  );
}

interface VoiceOrbProps {
  onStart: () => void;
  onStop: () => void;
  onInterrupt: () => void;
}

export function VoiceOrb({ onStart, onStop, onInterrupt }: VoiceOrbProps) {
  const state = useVoiceStore((store) => store.state);
  const agent = useVoiceStore((store) => store.activeAgent);
  const audioLevel = useVoiceStore((store) => store.audioLevel);
  const profile = AGENT_PROFILES[agent];
  const color = profile.color;

  function handleClick() {
    if (state === "listening") {
      onStop();
      return;
    }
    if (state === "speaking" || state === "thinking") {
      onInterrupt();
      return;
    }
    onStart();
  }

  const icon =
    state === "listening" ? <SquareIcon size={20} /> :
    state === "speaking" ? <VolumeIcon size={22} /> :
    state === "error" ? <MicOffIcon size={22} /> :
    <MicIcon size={22} />;

  const glowOpacity = state === "listening" ? 0.4 + audioLevel * 2 :
    state === "speaking" ? 0.3 + audioLevel * 2 :
    state === "thinking" ? 0.2 :
    0.1;

  const scale = state === "listening" ? 1 + audioLevel * 0.3 :
    state === "speaking" ? 1 + audioLevel * 0.2 :
    1;

  const orbStyle: CSSProperties = {
    borderColor: `${color}40`,
    background: `radial-gradient(circle, ${color}${Math.round(glowOpacity * 255).toString(16).padStart(2, "0")} 0%, rgba(0,0,0,0.6) 70%)`,
    transform: `scale(${scale})`,
    color,
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${profile.displayName} voice: ${state}`}
      data-agent={agent}
      data-state={state}
      className="relative grid size-14 place-items-center rounded-full border backdrop-blur-xl transition hover:scale-105 active:scale-95"
      style={orbStyle}
    >
      {(state === "listening" || state === "speaking") && (
        <span
          className="absolute inset-0 animate-ping rounded-full border opacity-30"
          style={{ borderColor: color }}
        />
      )}
      {state === "thinking" && (
        <span
          className="absolute inset-0 animate-spin rounded-full border-2 border-t-transparent opacity-40"
          style={{ borderColor: `${color} transparent transparent transparent` }}
        />
      )}
      {icon}
    </button>
  );
}
