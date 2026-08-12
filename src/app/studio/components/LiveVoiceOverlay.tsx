"use client";

/**
 * LiveVoiceOverlay — fullscreen realtime call screen for LiTT Live.
 *
 * 4 visual layers:
 *   0. Fallback (dark bg when camera off)
 *   1. Live camera feed (full-bleed, mirrored)
 *   2. Cinematic gradient + vignette
 *   3. HUD + LiTT Core + controls
 *
 * The LiTT Core is a holographic AI presence with state-driven animation:
 *   idle / listening / thinking / speaking / error
 *
 * The <video> element is always mounted — toggling camera changes opacity,
 * not conditional rendering, so stream attachment stays stable.
 *
 * @see src/app/studio/hooks/useLiTTRealtimeSession.ts
 * @see src/lib/litt/live/LiTTRealtimeSessionController.ts
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  RefreshCw,
  AlertCircle,
  Activity,
  SwitchCamera,
  Monitor,
  MonitorOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UseLiTTRealtimeSession } from "../hooks/useLiTTRealtimeSession";
import type { LiTTLiveSessionContext, LiveSessionState } from "@/lib/litt/live/types";

export interface LiveVoiceOverlayProps {
  session: UseLiTTRealtimeSession;
  context: LiTTLiveSessionContext;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
  onEnd: () => void;
}

// ─── LiTT Core visual states ─────────────────────────────────────

type LiTTRealtimeState = "idle" | "listening" | "thinking" | "speaking" | "error";

const STATE_LABELS: Record<LiTTRealtimeState, string> = {
  idle: "LiTT is ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Connection issue",
};

// ─── Session state → LiTT Core state mapping ─────────────────────

function deriveLiTTState(
  sessionState: LiveSessionState,
  userTranscript: string,
  assistantTranscript: string,
): LiTTRealtimeState {
  // Error / non-live states
  if (
    sessionState === "failed" ||
    sessionState === "permission_denied"
  ) {
    return "error";
  }
  if (
    sessionState === "idle" ||
    sessionState === "ended"
  ) {
    return "idle";
  }
  // Live states — derive sub-state from transcripts
  if (
    sessionState === "live_audio" ||
    sessionState === "live_vision" ||
    sessionState === "live_audio_and_vision"
  ) {
    if (assistantTranscript) return "speaking";
    if (userTranscript) return "listening";
    // Connected but no active transcript — could be thinking (turn just
    // committed) or idle. We check if we're between turns.
    return "idle";
  }
  // Connecting / requesting / reconnecting → thinking
  return "thinking";
}

// ─── Camera display states ───────────────────────────────────────

type CameraDisplayState = "idle" | "requesting" | "active" | "failed" | "disabled";

const CAMERA_STATE_LABELS: Record<CameraDisplayState, string> = {
  idle: "Camera off",
  requesting: "Starting camera…",
  active: "",
  failed: "Camera unavailable",
  disabled: "Camera off",
};

// ─── Precomputed particle positions (avoid re-random per render) ─

const PARTICLE_COUNT = 8;

function useParticlePositions() {
  return useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => ({
        left: 15 + Math.random() * 70,
        delay: Math.random() * 3,
      })),
    [],
  );
}

// ─── Component ───────────────────────────────────────────────────

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
    flipCamera,
    startScreenShare,
    stopScreenShare,
    interrupt,
    reconnect,
  } = session;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraDisplay, setCameraDisplay] = useState<CameraDisplayState>("idle");
  const particles = useParticlePositions();

  // Register transcript handler
  useEffect(() => {
    if (onTranscript) {
      session.onTranscript((t) => {
        if (t.isFinal) onTranscript(t.role, t.text);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start the session when the overlay mounts.
  // Camera starts ON so the user sees themselves immediately.
  useEffect(() => {
    if (videoRef.current && state === "idle") {
      setCameraDisplay("requesting");
      void session.start(videoRef.current, context, {
        camera: true,
        microphone: true,
      }).then(() => {
        // The controller attaches the stream to videoRef in start().
        setCameraDisplay("active");
      }).catch(() => {
        setCameraDisplay("failed");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync camera display state with indicators
  useEffect(() => {
    if (indicators.cameraPreview === "active") {
      setCameraDisplay("active");
    } else if (indicators.cameraPreview === "denied" || indicators.cameraPreview === "error") {
      setCameraDisplay("failed");
    } else if (indicators.cameraPreview === "inactive") {
      setCameraDisplay((prev) => (prev === "requesting" ? prev : "disabled"));
    }
  }, [indicators.cameraPreview]);

  // Ensure video plays after stream attachment (handles autoplay restrictions)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playVideo = async () => {
      try {
        await video.play();
      } catch {
        // Autoplay may be blocked until user interaction — non-fatal
      }
    };

    if (video.readyState >= 1 && video.srcObject) {
      void playVideo();
    } else {
      video.addEventListener("loadedmetadata", playVideo, { once: true });
    }

    return () => {
      video.removeEventListener("loadedmetadata", playVideo);
    };
  }, [indicators.cameraPreview]);

  // Detect broken camera streams
  useEffect(() => {
    if (indicators.cameraPreview !== "active") return;
    // The controller manages the stream; we just watch indicator changes.
    // If it drops to "error" we already handle that above.
  }, [indicators.cameraPreview]);

  const handleEnd = () => {
    session.end();
    onEnd();
  };

  const handleCameraToggle = () => {
    setCameraDisplay((prev) => {
      if (prev === "active") return "disabled";
      if (prev === "disabled" || prev === "failed") return "requesting";
      return prev;
    });
    void toggleCamera();
  };

  const handleFlip = async () => {
    await flipCamera();
  };

  // ─── Derived state ─────────────────────────────────────────────

  const littState = deriveLiTTState(state, userTranscript, assistantTranscript);
  const isMuted = indicators.microphone === "muted";
  const cameraOn = indicators.cameraPreview === "active";
  const screenOn = indicators.screen === "active";
  const visionActive = indicators.littVision === "connected";
  const voiceActive = indicators.littAudio === "connected";
  const showEllipsis = littState !== "idle" && littState !== "error";
  const cameraVisible = cameraOn && cameraDisplay === "active";

  return (
    <div
      className="fixed inset-0 z-[10020] overflow-hidden bg-[#05050b]"
      role="dialog"
      aria-label="LiTT Live Voice"
      data-testid="live-voice-overlay"
    >
      {/* ─── Layer 0: Fallback (visible when camera off) ─────── */}
      <div
        className={cn(
          "absolute inset-0 z-0 transition-opacity duration-500",
          cameraVisible ? "opacity-0" : "opacity-100",
        )}
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(16,185,129,0.08), transparent 35%)," +
            "radial-gradient(circle at 80% 20%, rgba(124,58,237,0.08), transparent 30%)," +
            "#05050b",
        }}
      />

      {/* ─── Layer 1: Live camera feed ──────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
        className={cn(
          "absolute inset-0 z-[1] h-full w-full object-cover scale-x-[-1] transition-opacity duration-500",
          cameraVisible ? "opacity-100" : "opacity-0",
        )}
      />

      {/* ─── Layer 2: Cinematic gradient ───────────────────── */}
      <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-black/35 via-black/10 to-black/65" />

      {/* ─── Layer 3: Vignette ──────────────────────────────── */}
      <div className="litt-vignette pointer-events-none absolute inset-0 z-[3]" />

      {/* ─── Error banner ───────────────────────────────────── */}
      {error && (
        <div
          className="absolute left-1/2 top-20 z-[15] flex -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-bold backdrop-blur-md"
          style={{
            borderColor: "rgba(239,68,68,0.3)",
            backgroundColor: "rgba(239,68,68,0.12)",
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

      {/* ─── Layer 10: Top HUD ──────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* Top-left: LiTT LIVE + connection */}
        <div className="absolute left-5 top-5">
          <div className="text-xs font-semibold tracking-[0.2em] text-white">
            LiTT LIVE
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-white/45">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isLive ? "bg-emerald-400" : isConnecting ? "bg-amber-400" : "bg-red-400",
              )}
            />
            {isLive ? "CONNECTED" : isConnecting ? "CONNECTING" : "OFFLINE"}
          </div>
        </div>

        {/* Top-right: Vision + Voice status */}
        <div className="absolute right-5 top-5 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider text-white/50">
            VISION
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                visionActive ? "bg-emerald-400" : "bg-white/20",
              )}
            />
          </div>
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider text-white/50">
            VOICE
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                voiceActive ? "bg-emerald-400" : "bg-white/20",
              )}
            />
          </div>
        </div>
      </div>

      {/* ─── Layer 20: LiTT Core ────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div
          className="flex flex-col items-center"
          style={{
            position: "absolute",
            left: "50%",
            top: "62%",
            transform: "translate(-50%, -50%)",
          }}
        >
          {/* Holographic particles */}
          {particles.map((p, i) => (
            <span
              key={i}
              className="litt-particle"
              style={{
                left: `${p.left}%`,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}

          {/* Core container */}
          <div className="litt-core-container">
            <div className="litt-core-aura" data-state={littState} />

            <div className="litt-core-ring litt-core-ring-one" data-state={littState} />
            <div className="litt-core-ring litt-core-ring-two" data-state={littState} />
            <div className="litt-core-ring litt-core-ring-three" data-state={littState} />

            <div className="litt-core-orb" data-state={littState}>
              <div className="litt-waveform" data-state={littState}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    style={{ animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* State label */}
          <div className="mt-6 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.45em] text-white/40">
              LiTT
            </div>
            <div className="mt-2 text-xl font-semibold text-white">
              {STATE_LABELS[littState]}
              {showEllipsis && <span className="litt-ellipsis" />}
            </div>
          </div>

          {/* Live captions */}
          {(userTranscript || assistantTranscript) && (
            <div className="mt-4 max-w-md space-y-2 text-center">
              {userTranscript && (
                <p className="text-[13px] font-medium text-white/70">
                  <span className="text-[10px] font-bold uppercase opacity-50">You: </span>
                  {userTranscript}
                </p>
              )}
              {assistantTranscript && (
                <p className="text-[13px] font-medium text-emerald-300">
                  <span className="text-[10px] font-bold uppercase opacity-50">LiTT: </span>
                  {assistantTranscript}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Camera state label (when not active) ───────────── */}
      {!cameraVisible && cameraDisplay !== "active" && (
        <div className="pointer-events-none absolute left-1/2 top-[38%] z-[15] -translate-x-1/2 text-center">
          <p className="text-[11px] font-medium tracking-wider text-white/30">
            {CAMERA_STATE_LABELS[cameraDisplay]}
          </p>
          {cameraDisplay === "failed" && (
            <button
              type="button"
              onClick={handleCameraToggle}
              className="pointer-events-auto mt-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-white/60 hover:bg-white/10"
            >
              Retry camera
            </button>
          )}
        </div>
      )}

      {/* ─── Layer 30: Bottom controls (glass command dock) ─── */}
      <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/30 px-3 py-2 shadow-2xl backdrop-blur-xl">
          {/* Camera toggle */}
          <button
            type="button"
            onClick={handleCameraToggle}
            disabled={!isLive && cameraDisplay !== "failed"}
            className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 disabled:opacity-40"
            style={{
              color: cameraOn ? "#22d3ee" : "rgba(255,255,255,0.4)",
              backgroundColor: cameraOn ? "rgba(34,211,238,0.1)" : "transparent",
              boxShadow: cameraOn ? "0 0 0 2px rgba(34,211,238,0.3)" : undefined,
            }}
            aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
            title="Camera"
          >
            {cameraOn ? <Video size={20} className="pointer-events-none" /> : <VideoOff size={20} className="pointer-events-none" />}
          </button>

          {/* Flip camera (mobile) */}
          <button
            type="button"
            onClick={() => void handleFlip()}
            disabled={!isLive || !cameraOn}
            className="flex h-12 w-12 items-center justify-center rounded-full text-white/40 transition-all hover:bg-white/10 disabled:opacity-30"
            aria-label="Flip camera"
            title="Flip camera"
          >
            <SwitchCamera size={20} className="pointer-events-none" />
          </button>

          {/* Screen share (desktop only — hidden on mobile) */}
          <button
            type="button"
            onClick={() => (screenOn ? stopScreenShare() : void startScreenShare())}
            disabled={!isLive}
            className="hidden h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 disabled:opacity-40 md:flex"
            style={{
              color: screenOn ? "#22d3ee" : "rgba(255,255,255,0.4)",
              backgroundColor: screenOn ? "rgba(34,211,238,0.1)" : "transparent",
            }}
            aria-label={screenOn ? "Stop screen share" : "Share screen"}
            title="Screen share"
          >
            {screenOn ? <Monitor size={20} className="pointer-events-none" /> : <MonitorOff size={20} className="pointer-events-none" />}
          </button>

          {/* Mic toggle */}
          <button
            type="button"
            onClick={toggleMute}
            disabled={!isLive}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 disabled:opacity-40",
            )}
            style={{
              color: isMuted ? "#ef4444" : isLive ? "#22c55e" : "rgba(255,255,255,0.4)",
              backgroundColor: isMuted ? "rgba(239,68,68,0.1)" : isLive ? "rgba(34,197,94,0.08)" : "transparent",
              boxShadow: isLive && !isMuted ? "0 0 0 2px rgba(34,197,94,0.2)" : undefined,
            }}
            aria-label={isMuted ? "Unmute" : "Mute"}
            title="Microphone"
          >
            {isMuted ? <MicOff size={20} className="pointer-events-none" /> : <Mic size={20} className="pointer-events-none" />}
          </button>

          {/* Interrupt (while LiTT is speaking) */}
          {isLive && assistantTranscript && (
            <button
              type="button"
              onClick={interrupt}
              className="flex h-12 w-12 items-center justify-center rounded-full text-cyan-300 transition-all hover:bg-white/10"
              aria-label="Interrupt LiTT"
              title="Interrupt"
            >
              <Activity size={20} className="pointer-events-none" />
            </button>
          )}

          {/* Reconnect (degraded/failed) */}
          {(state === "degraded" || state === "failed") && (
            <button
              type="button"
              onClick={() => void reconnect()}
              className="flex h-12 w-12 items-center justify-center rounded-full text-amber-400 transition-all hover:bg-white/10"
              aria-label="Reconnect"
              title="Reconnect"
            >
              <RefreshCw size={20} className="pointer-events-none" />
            </button>
          )}

          {/* Divider */}
          <div className="h-8 w-px bg-white/10" />

          {/* Hang up */}
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
    </div>
  );
}
