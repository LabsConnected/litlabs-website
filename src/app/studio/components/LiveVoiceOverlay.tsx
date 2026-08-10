"use client";

/**
 * LiveVoiceOverlay — centered fullscreen overlay for Live Voice mode.
 *
 * Replaces the old LiTTLivePanel side panel with a proper centered overlay:
 *   - Animated waveform
 *   - "I'm listening…" / "Thinking…" / "Speaking…" status
 *   - Live captions (user + assistant transcripts)
 *   - Controls: Camera, Screen Share, Mute, End
 *   - States: Listening, Thinking, Speaking, Muted, Reconnecting
 *   - Restores the normal composer when ended
 *
 * Uses the existing useLiTTRealtimeSession hook + LiTTRealtimeSessionController.
 */

import { useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  RefreshCw,
  AlertCircle,
  Activity,
} from "lucide-react";
import type { UseLiTTRealtimeSession } from "../hooks/useLiTTRealtimeSession";
import type { LiTTLiveSessionContext, LiveSessionState } from "@/lib/litt/live/types";

export interface LiveVoiceOverlayProps {
  session: UseLiTTRealtimeSession;
  context: LiTTLiveSessionContext;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
  onEnd: () => void;
}

const STATE_LABELS: Record<LiveSessionState, string> = {
  idle: "LiTT Live",
  requesting_permission: "Requesting permission…",
  local_preview: "Starting camera…",
  connecting: "Connecting to LiTT…",
  live_audio: "Listening…",
  live_vision: "Listening…",
  live_audio_and_vision: "Listening…",
  reconnecting: "Reconnecting…",
  degraded: "Connection degraded",
  permission_denied: "Permission required",
  failed: "Connection failed",
  ended: "Session ended",
};

const STATE_COLORS: Record<LiveSessionState, string> = {
  idle: "#6b7280",
  requesting_permission: "#f59e0b",
  local_preview: "#f59e0b",
  connecting: "#f59e0b",
  live_audio: "#22c55e",
  live_vision: "#22c55e",
  live_audio_and_vision: "#22c55e",
  reconnecting: "#f59e0b",
  degraded: "#f59e0b",
  permission_denied: "#ef4444",
  failed: "#ef4444",
  ended: "#6b7280",
};

/**
 * Derive a truthful sub-state from the session state + transcript content.
 * - "listening" — user is speaking (userTranscript present, no assistant response yet)
 * - "thinking" — turn complete from user, waiting for assistant response
 * - "speaking" — assistant is responding (assistantTranscript present)
 * - "connected" — live but idle
 */
function getLiveSubState(
  state: LiveSessionState,
  userTranscript: string,
  assistantTranscript: string,
): "connected" | "listening" | "thinking" | "speaking" {
  if (state !== "live_audio" && state !== "live_vision" && state !== "live_audio_and_vision") {
    return "connected";
  }
  if (assistantTranscript) return "speaking";
  if (userTranscript) return "listening";
  return "connected";
}

const SUB_STATE_LABELS: Record<string, string> = {
  connected: "Listening…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export default function LiveVoiceOverlay({
  session,
  context,
  onTranscript,
  onEnd,
}: LiveVoiceOverlayProps) {
  const {
    state,
    indicators,
    userTranscript,
    assistantTranscript,
    error,
    isLive,
    isConnecting,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    interrupt,
    reconnect,
  } = session;

  const videoRef = useRef<HTMLVideoElement>(null);

  // Register transcript handler
  useEffect(() => {
    if (onTranscript) {
      session.onTranscript((t) => {
        if (t.isFinal) onTranscript(t.role, t.text);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start the session when the overlay mounts
  useEffect(() => {
    if (videoRef.current && state === "idle") {
      void session.start(videoRef.current, context, {
        camera: false,
        microphone: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnd = () => {
    session.end();
    onEnd();
  };

  const color = STATE_COLORS[state] ?? "#6b7280";
  const isMuted = indicators.microphone === "muted";
  const cameraOn = indicators.cameraPreview === "active";
  const screenOn = indicators.screen === "active";
  const subState = getLiveSubState(state, userTranscript, assistantTranscript);
  const statusLabel = isLive ? SUB_STATE_LABELS[subState] : STATE_LABELS[state];

  return (
    <div
      className="fixed inset-0 z-[10020] flex flex-col items-center justify-center"
      style={{
        backgroundColor: "rgba(7,8,18,0.95)",
        backdropFilter: "blur(20px)",
      }}
      role="dialog"
      aria-label="LiTT Live Voice"
      data-testid="live-voice-overlay"
    >
      {/* Hidden video element for camera/screen preview */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />

      {/* Error display */}
      {error && (
        <div
          className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-bold"
          style={{
            borderColor: "rgba(239,68,68,0.3)",
            backgroundColor: "rgba(239,68,68,0.1)",
            color: "#fca5a5",
          }}
          role="alert"
        >
          <AlertCircle size={14} className="pointer-events-none" />
          {error.message}
          {error.retryable && (
            <button
              type="button"
              onClick={() => void reconnect()}
              className="ml-2 rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Center content */}
      <div className="flex flex-col items-center gap-6 px-6">
        {/* LiTT label */}
        <span className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: "var(--text-muted)" }}>
          LiTT
        </span>

        {/* Animated waveform — 7 bars that pulse based on state */}
        <div className="flex items-end gap-1.5" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const baseHeight = isLive ? 8 : 4;
            const amplitude = isLive ? 24 : 6;
            const height = baseHeight + Math.abs(Math.sin(Date.now() / 300 + i * 0.7)) * amplitude;
            return (
              <span
                key={i}
                className="w-1.5 rounded-full transition-all"
                style={{
                  height: `${height}px`,
                  backgroundColor: color,
                  opacity: isLive ? 0.8 : 0.3,
                }}
              />
            );
          })}
        </div>

        {/* Status text */}
        <div className="text-center">
          <p className="text-xl font-black" style={{ color }}>
            {statusLabel}
          </p>
          {isConnecting && (
            <p className="mt-1 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              Establishing realtime connection…
            </p>
          )}
        </div>

        {/* Live captions */}
        {(userTranscript || assistantTranscript) && (
          <div className="max-w-md space-y-2 text-center">
            {userTranscript && (
              <p className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
                <span className="text-[10px] font-bold uppercase opacity-50">You: </span>
                {userTranscript}
              </p>
            )}
            {assistantTranscript && (
              <p className="text-[13px] font-medium" style={{ color: "#65f4ff" }}>
                <span className="text-[10px] font-bold uppercase opacity-50">LiTT: </span>
                {assistantTranscript}
              </p>
            )}
          </div>
        )}

        {/* Privacy notice */}
        {state === "live_audio_and_vision" && (
          <p className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
            Camera and microphone are active. LiTT can see and hear you.
          </p>
        )}
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3">
        {/* Camera toggle */}
        <button
          type="button"
          onClick={toggleCamera}
          disabled={!isLive}
          className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 disabled:opacity-40"
          style={{
            color: cameraOn ? "#22d3ee" : "var(--text-muted)",
            backgroundColor: cameraOn ? "rgba(34,211,238,0.1)" : "transparent",
            boxShadow: cameraOn ? "0 0 0 2px rgba(34,211,238,0.3)" : undefined,
          }}
          aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
          title="Camera"
        >
          {cameraOn ? <Video size={20} className="pointer-events-none" /> : <VideoOff size={20} className="pointer-events-none" />}
        </button>

        {/* Screen share toggle */}
        <button
          type="button"
          onClick={() => (screenOn ? stopScreenShare() : void startScreenShare())}
          disabled={!isLive}
          className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 disabled:opacity-40"
          style={{
            color: screenOn ? "#22d3ee" : "var(--text-muted)",
            backgroundColor: screenOn ? "rgba(34,211,238,0.1)" : "transparent",
          }}
          aria-label={screenOn ? "Stop screen share" : "Share screen"}
          title="Screen share"
        >
          {screenOn ? <Monitor size={20} className="pointer-events-none" /> : <MonitorOff size={20} className="pointer-events-none" />}
        </button>

        {/* Mute toggle */}
        <button
          type="button"
          onClick={toggleMute}
          disabled={!isLive}
          className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 disabled:opacity-40"
          style={{
            color: isMuted ? "#e3b341" : "var(--text-muted)",
            backgroundColor: isMuted ? "rgba(227,179,65,0.1)" : "transparent",
          }}
          aria-label={isMuted ? "Unmute" : "Mute"}
          title="Mute"
        >
          {isMuted ? <MicOff size={20} className="pointer-events-none" /> : <Mic size={20} className="pointer-events-none" />}
        </button>

        {/* Interrupt (while LiTT is speaking) */}
        {isLive && assistantTranscript && (
          <button
            type="button"
            onClick={interrupt}
            className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10"
            style={{ color: "#65f4ff" }}
            aria-label="Interrupt LiTT"
            title="Interrupt"
          >
            <Activity size={20} className="pointer-events-none" />
          </button>
        )}

        {/* Reconnect */}
        {(state === "degraded" || state === "failed") && (
          <button
            type="button"
            onClick={() => void reconnect()}
            className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10"
            style={{ color: "#f59e0b" }}
            aria-label="Reconnect"
            title="Reconnect"
          >
            <RefreshCw size={20} className="pointer-events-none" />
          </button>
        )}

        {/* End session */}
        <button
          type="button"
          onClick={handleEnd}
          className="flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95"
          style={{
            backgroundColor: "rgba(239,68,68,0.15)",
            color: "#ef4444",
            boxShadow: "0 0 0 2px rgba(239,68,68,0.3)",
          }}
          aria-label="End Live Voice session"
          title="End"
          data-testid="end-live-voice"
        >
          <PhoneOff size={22} className="pointer-events-none" />
        </button>
      </div>
    </div>
  );
}
