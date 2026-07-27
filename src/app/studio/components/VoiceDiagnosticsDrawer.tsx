"use client";

/**
 * VoiceDiagnosticsDrawer — development observability for the voice session.
 * Shows real-time state of the OpenAI Realtime WebRTC session.
 *
 * Toggle with the keyboard shortcut Ctrl+Shift+V or via the diagnostics button.
 */

import { useState, useEffect } from "react";
import { useVoiceSession } from "../context/VoiceSessionContext";

export function VoiceDiagnosticsDrawer() {
  const { diagnostics, voiceState, voiceInputState, voiceOutputState, voiceTransportConnected } = useVoiceSession();
  const [open, setOpen] = useState(false);

  // Toggle with Ctrl+Shift+V
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "V") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[9999] rounded-lg border border-white/10 bg-black/80 px-2 py-1 text-[10px] font-mono text-white/50 backdrop-blur hover:text-white/80"
        title="Voice Diagnostics (Ctrl+Shift+V)"
      >
        Voice Diagnostics
      </button>
    );
  }

  const rows: Array<[string, string]> = [
    ["Provider", diagnostics.provider],
    ["Session ID", diagnostics.sessionId ?? "—"],
    ["Token created", diagnostics.tokenCreatedAt ? new Date(diagnostics.tokenCreatedAt).toLocaleTimeString() : "—"],
    ["Transport", voiceTransportConnected ? "connected" : "disconnected"],
    ["Connection state", diagnostics.connectionState ?? "—"],
    ["ICE state", diagnostics.iceConnectionState ?? "—"],
    ["Data channel", diagnostics.dataChannelState ?? "—"],
    ["Mic permission", diagnostics.micPermission ?? "—"],
    ["Track state", diagnostics.trackReadyState ?? "—"],
    ["Track enabled", diagnostics.trackEnabled === null ? "—" : diagnostics.trackEnabled ? "true" : "false"],
    ["Voice phase", voiceState],
    ["Input state", voiceInputState],
    ["Output state", voiceOutputState],
    ["Turn number", String(diagnostics.turnNumber)],
    ["Last transcript", diagnostics.lastTranscriptEvent ?? "—"],
    ["Last assistant", diagnostics.lastAssistantEvent ?? "—"],
    ["Last playback", diagnostics.lastPlaybackEvent ?? "—"],
    ["Last error", diagnostics.lastError ?? "—"],
  ];

  return (
    <div className="fixed bottom-4 left-4 z-[9999] w-80 rounded-xl border border-white/10 bg-black/95 p-3 font-mono text-[10px] text-white/70 shadow-2xl backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-cyan-300">Voice Diagnostics</span>
        <button
          onClick={() => setOpen(false)}
          className="text-white/40 hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="space-y-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-white/40">{label}</span>
            <span className={`text-right ${value === "error" ? "text-red-400" : value === "connected" || value === "listening" ? "text-emerald-400" : "text-white/70"}`}>
              {value}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-white/10 pt-1 text-white/30">
        Press Ctrl+Shift+V to toggle
      </div>
    </div>
  );
}
