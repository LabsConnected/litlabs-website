"use client";

/**
 * VoiceDiagnosticsDrawer — per-stage observability for the voice session.
 *
 * Shows the status of each pipeline stage:
 *   Microphone → Transport → Transcription → Response → TTS → Playback
 *
 * Each stage shows: ready / blocked / error / not-tested
 * Toggle with Ctrl+Shift+V or via the diagnostics button.
 */

import { useState, useEffect } from "react";
import { useVoiceSession } from "../context/VoiceSessionContext";

type StageStatus = "ready" | "blocked" | "error" | "not-tested" | "unknown";

interface Stage {
  name: string;
  status: StageStatus;
  detail: string;
}

export function VoiceDiagnosticsDrawer() {
  const { diagnostics, voiceState, voiceInputState, voiceOutputState, voiceTransportConnected, errorMessage } = useVoiceSession();
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

  // ── Derive per-stage status from diagnostics ──

  const micStage: Stage = (() => {
    if (diagnostics.micPermission === "denied") {
      return { name: "Microphone", status: "blocked", detail: "Permission denied" };
    }
    if (diagnostics.trackReadyState === "live" && diagnostics.trackEnabled) {
      return { name: "Microphone", status: "ready", detail: "Stream active" };
    }
    if (diagnostics.trackReadyState === "live" && !diagnostics.trackEnabled) {
      return { name: "Microphone", status: "ready", detail: "Stream open, mic muted" };
    }
    if (voiceState === "requesting_permission") {
      return { name: "Microphone", status: "not-tested", detail: "Requesting permission…" };
    }
    return { name: "Microphone", status: "not-tested", detail: "Not started — click the mic button" };
  })();

  const transportStage: Stage = (() => {
    if (diagnostics.connectionState === "connected") {
      return { name: "Transport (WebRTC)", status: "ready", detail: `ICE: ${diagnostics.iceConnectionState ?? "—"}` };
    }
    if (diagnostics.connectionState === "connecting" || voiceState === "connecting") {
      return { name: "Transport (WebRTC)", status: "not-tested", detail: "Connecting…" };
    }
    if (diagnostics.connectionState === "failed") {
      return { name: "Transport (WebRTC)", status: "error", detail: diagnostics.lastError ?? "ICE failed" };
    }
    if (diagnostics.lastError && !voiceTransportConnected) {
      return { name: "Transport (WebRTC)", status: "error", detail: diagnostics.lastError };
    }
    return { name: "Transport (WebRTC)", status: "not-tested", detail: "Not connected" };
  })();

  const transcriptionStage: Stage = (() => {
    if (diagnostics.lastTranscriptEvent?.startsWith("final:")) {
      return { name: "Transcription", status: "ready", detail: diagnostics.lastTranscriptEvent };
    }
    if (diagnostics.lastTranscriptEvent?.startsWith("delta:")) {
      return { name: "Transcription", status: "ready", detail: "Receiving partial transcript" };
    }
    if (voiceInputState === "listening") {
      return { name: "Transcription", status: "not-tested", detail: "Listening — no speech detected yet" };
    }
    return { name: "Transcription", status: "not-tested", detail: "No transcript events yet" };
  })();

  const responseStage: Stage = (() => {
    if (diagnostics.lastAssistantEvent) {
      return { name: "Model Response", status: "ready", detail: diagnostics.lastAssistantEvent };
    }
    if (voiceState === "processing") {
      return { name: "Model Response", status: "not-tested", detail: "Waiting for response…" };
    }
    return { name: "Model Response", status: "not-tested", detail: "No response yet" };
  })();

  const ttsStage: Stage = (() => {
    if (diagnostics.lastPlaybackEvent === "completed") {
      return { name: "TTS Engine", status: "ready", detail: "Audio played successfully" };
    }
    if (diagnostics.lastPlaybackEvent?.startsWith("started:")) {
      return { name: "TTS Engine", status: "ready", detail: "Audio playing…" };
    }
    if (errorMessage && voiceState === "error") {
      return { name: "TTS Engine", status: "error", detail: errorMessage };
    }
    if (voiceOutputState === "speaking") {
      return { name: "TTS Engine", status: "ready", detail: "Speaking…" };
    }
    return { name: "TTS Engine", status: "not-tested", detail: "Not tested yet" };
  })();

  const playbackStage: Stage = (() => {
    if (diagnostics.lastPlaybackEvent === "completed") {
      return { name: "Audio Playback", status: "ready", detail: "Playback completed" };
    }
    if (diagnostics.lastPlaybackEvent?.startsWith("started:")) {
      return { name: "Audio Playback", status: "ready", detail: "Playing…" };
    }
    return { name: "Audio Playback", status: "not-tested", detail: "No playback events yet" };
  })();

  const stages = [micStage, transportStage, transcriptionStage, responseStage, ttsStage, playbackStage];

  // Overall status
  const hasError = stages.some((s) => s.status === "error");
  const hasBlocked = stages.some((s) => s.status === "blocked");
  const allReady = stages.every((s) => s.status === "ready" || s.status === "not-tested");
  const overallStatus = hasError ? "error" : hasBlocked ? "blocked" : allReady ? "ready" : "unknown";
  const overallLabel = {
    ready: "Voice · Ready",
    error: "Voice · Error",
    blocked: "Voice · Blocked",
    unknown: "Voice · Unknown",
  }[overallStatus];
  const overallColor = {
    ready: "#22c55e",
    error: "#ef4444",
    blocked: "#f59e0b",
    unknown: "#6b7280",
  }[overallStatus];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[9999] rounded-lg border border-white/10 bg-black/80 px-2 py-1 text-[10px] font-mono backdrop-blur hover:text-white/80"
        style={{ color: overallColor }}
        title="Voice Diagnostics (Ctrl+Shift+V)"
      >
        {overallLabel}
      </button>
    );
  }

  const statusColor = (status: StageStatus) => {
    switch (status) {
      case "ready": return "text-emerald-400";
      case "error": return "text-red-400";
      case "blocked": return "text-amber-400";
      case "not-tested": return "text-white/40";
      default: return "text-white/50";
    }
  };

  const statusIcon = (status: StageStatus) => {
    switch (status) {
      case "ready": return "✓";
      case "error": return "✗";
      case "blocked": return "⚠";
      case "not-tested": return "○";
      default: return "?";
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[9999] w-80 rounded-xl border border-white/10 bg-black/95 p-3 font-mono text-[10px] text-white/70 shadow-2xl backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold" style={{ color: overallColor }}>{overallLabel}</span>
        <button
          onClick={() => setOpen(false)}
          className="text-white/40 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* Per-stage status */}
      <div className="space-y-1">
        {stages.map((stage) => (
          <div key={stage.name} className="border-b border-white/5 pb-1">
            <div className="flex items-center justify-between">
              <span className="text-white/60">{stage.name}</span>
              <span className={statusColor(stage.status)}>
                {statusIcon(stage.status)} {stage.status}
              </span>
            </div>
            <div className="mt-0.5 text-white/35">{stage.detail}</div>
          </div>
        ))}
      </div>

      {/* Raw diagnostics (collapsible) */}
      <details className="mt-2">
        <summary className="cursor-pointer text-white/40 hover:text-white/60">Raw diagnostics</summary>
        <div className="mt-1 space-y-0.5">
          <div className="flex justify-between"><span className="text-white/30">Provider</span><span>{diagnostics.provider}</span></div>
          <div className="flex justify-between"><span className="text-white/30">Voice phase</span><span>{voiceState}</span></div>
          <div className="flex justify-between"><span className="text-white/30">Input state</span><span>{voiceInputState}</span></div>
          <div className="flex justify-between"><span className="text-white/30">Output state</span><span>{voiceOutputState}</span></div>
          <div className="flex justify-between"><span className="text-white/30">Turn #</span><span>{diagnostics.turnNumber}</span></div>
          <div className="flex justify-between"><span className="text-white/30">Data channel</span><span>{diagnostics.dataChannelState ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-white/30">Token created</span><span>{diagnostics.tokenCreatedAt ? new Date(diagnostics.tokenCreatedAt).toLocaleTimeString() : "—"}</span></div>
          {diagnostics.lastError && (
            <div className="mt-1 rounded bg-red-500/10 px-1 py-0.5 text-red-400">Error: {diagnostics.lastError}</div>
          )}
        </div>
      </details>

      <div className="mt-2 border-t border-white/10 pt-1 text-white/30">
        Press Ctrl+Shift+V to toggle
      </div>
    </div>
  );
}
