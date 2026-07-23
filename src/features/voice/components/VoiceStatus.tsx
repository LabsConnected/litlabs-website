"use client";

import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { AGENT_PROFILES } from "@/features/voice/lib/agentProfiles";

const STATE_LABELS: Record<string, string> = {
  idle: "Tap to speak",
  connecting: "Connecting…",
  listening: "Listening…",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  interrupted: "Interrupted",
  error: "Error — tap to retry",
};

export function VoiceStatus() {
  const state = useVoiceStore((store) => store.state);
  const agent = useVoiceStore((store) => store.activeAgent);
  const error = useVoiceStore((store) => store.error);
  const interimTranscript = useVoiceStore((store) => store.interimTranscript);
  const profile = AGENT_PROFILES[agent];

  const label = error || STATE_LABELS[state] || "Idle";

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div
        className="flex items-center gap-1.5 text-xs font-semibold"
        style={{ color: state === "error" ? "#ef4444" : profile.color }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: state === "error" ? "#ef4444" : profile.color,
            opacity: state === "idle" ? 0.4 : 1,
          }}
        />
        {profile.displayName} · {label}
      </div>
      {interimTranscript && state === "listening" && (
        <div className="max-w-xs truncate text-xs opacity-50">
          {interimTranscript}
        </div>
      )}
    </div>
  );
}
