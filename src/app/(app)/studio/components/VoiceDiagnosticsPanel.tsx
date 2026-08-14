"use client";

/**
 * VoiceDiagnosticsPanel — development-only voice diagnostics.
 *
 * Shows real-time voice system state for debugging ghost transcription,
 * echo issues, and VAD behavior. Only rendered when
 * NEXT_PUBLIC_VOICE_DIAGNOSTICS is "1" or localStorage flag is set.
 *
 * NEVER expose raw audio or diagnostics in production.
 *
 * @see VoiceSessionContext.tsx for the diagnostics data source
 */

import { useVoiceSession } from "@/app/(app)/studio/context/VoiceSessionContext";

export function VoiceDiagnosticsPanel() {
  const { diagnostics, micLevel, voiceState, voiceInputState, voiceOutputState } = useVoiceSession();

  // Only show in development or when explicitly enabled
  if (process.env.NODE_ENV !== "development" && !diagnostics) return null;

  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: "Voice phase", value: voiceState },
    { label: "Input state", value: voiceInputState },
    { label: "Output state", value: voiceOutputState },
    { label: "Transport", value: diagnostics.transportConnected ? "connected" : "disconnected" },
    { label: "Mic active", value: diagnostics.micActive ? "yes" : "no" },
    { label: "Mic level", value: `${(micLevel * 100).toFixed(1)}%` },
    { label: "VAD state", value: diagnostics.vadState },
    { label: "Speech duration", value: `${diagnostics.lastSpeechDurationMs}ms` },
    { label: "Session gen", value: String(diagnostics.sessionGeneration) },
    { label: "Stream count", value: String(diagnostics.activeStreamCount) },
    { label: "Turn number", value: String(diagnostics.turnNumber) },
    {
      label: "Last transcript",
      value: diagnostics.lastTranscript ?? "(none)",
    },
    {
      label: "Rejection",
      value: diagnostics.lastRejectionReason ?? "(none)",
      color: diagnostics.lastRejectionReason && diagnostics.lastRejectionReason !== "accepted" ? "#e3b341" : undefined,
    },
    {
      label: "Rejection reason",
      value: diagnostics.lastRejectionExplanation ?? "(none)",
      color: diagnostics.lastRejectionReason && diagnostics.lastRejectionReason !== "accepted" ? "#e3b341" : undefined,
    },
    { label: "Error", value: diagnostics.lastError ?? "(none)", color: diagnostics.lastError ? "#ef4444" : undefined },
  ];

  return (
    <div
      className="fixed bottom-20 right-6 z-40 w-72 rounded-lg border p-3 text-[10px] font-mono"
      style={{
        borderColor: "rgba(255,255,255,0.1)",
        backgroundColor: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(8px)",
      }}
      data-testid="voice-diagnostics-panel"
    >
      <div className="mb-2 text-[9px] font-bold uppercase tracking-wider opacity-50">
        Voice Diagnostics (dev only)
      </div>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-2">
            <span className="opacity-50">{row.label}:</span>
            <span
              className="truncate text-right"
              style={{ color: row.color ?? "inherit" }}
              title={row.value}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
