"use client";

/**
 * LiTTLivePanel — the unified Live session UI.
 *
 * Shows:
 *   - Camera preview (local video element)
 *   - LiTT avatar / status
 *   - Truthful connection indicators (NOT "Camera live" lies)
 *   - Audio waveform placeholder
 *   - User and LiTT transcripts
 *   - Camera selector, mic selector, camera toggle, mute
 *   - Screen share, front/rear switch, end session, reconnect
 *   - Expand/fullscreen, privacy notice
 *   - Error display with retry
 *
 * @see src/app/studio/hooks/useLiTTRealtimeSession.ts
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  RefreshCw,
  PhoneOff,
  SwitchCamera,
  Maximize2,
  Minimize2,
  AlertCircle,
  Eye,
  EyeOff,
  Ear,
  EarOff,
  Activity,
  Shield,
} from "lucide-react";
import type { UseLiTTRealtimeSession } from "../hooks/useLiTTRealtimeSession";
import type { LiveSessionState, LiveConnectionIndicators } from "@/lib/litt/live/types";
import type { LiTTLiveSessionContext } from "@/lib/litt/live/types";

// ---------------------------------------------------------------------------
// State labels — truthful, not misleading
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<LiveSessionState, string> = {
  idle: "LiTT Live",
  requesting_permission: "Requesting permission…",
  local_preview: "Camera preview — connecting LiTT…",
  connecting: "Connecting LiTT…",
  live_audio: "LiTT Voice connected",
  live_vision: "LiTT Vision connected",
  live_audio_and_vision: "LiTT Live — Seeing • Listening • Ready",
  reconnecting: "Reconnecting…",
  degraded: "LiTT Live — Degraded",
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

// ---------------------------------------------------------------------------
// Indicator dot
// ---------------------------------------------------------------------------

function IndicatorDot({
  status,
}: {
  status: LiveConnectionIndicators[keyof LiveConnectionIndicators];
}) {
  const color =
    status === "active" || status === "connected"
      ? "bg-green-500"
      : status === "muted"
        ? "bg-yellow-500"
        : status === "denied" || status === "error"
          ? "bg-red-500"
          : status === "connecting"
            ? "bg-yellow-500 animate-pulse"
            : "bg-gray-600";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

// ---------------------------------------------------------------------------
// Control button
// ---------------------------------------------------------------------------

function ControlButton({
  onClick,
  disabled,
  active,
  title,
  "aria-label": ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  "aria-label": string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`grid h-9 w-9 place-items-center rounded-lg border transition-all active:scale-95 disabled:opacity-30 ${
        active
          ? "border-purple-400/40 bg-purple-400/20 text-purple-300"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
      style={{ borderColor: active ? "var(--studio-accent, #a855f7)" : undefined }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export interface LiTTLivePanelProps {
  session: UseLiTTRealtimeSession;
  context: LiTTLiveSessionContext;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function LiTTLivePanel({
  session,
  context,
  onTranscript,
  onToolCall,
  collapsed = false,
  onToggleCollapse,
}: LiTTLivePanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | undefined>();
  const [selectedMic, setSelectedMic] = useState<string | undefined>();
  const [showDeviceSelectors, setShowDeviceSelectors] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const {
    state,
    indicators,
    userTranscript,
    assistantTranscript,
    error,
    isLive,
    isConnecting,
    framesSent,
    start,
    end,
    toggleMute,
    toggleCamera,
    flipCamera,
    startScreenShare,
    stopScreenShare,
    interrupt,
    reconnect,
    clearError,
    onToolCall: registerToolCallHandler,
    onTranscript: registerTranscriptHandler,
  } = session;

  // Register transcript handler for persistence
  useEffect(() => {
    if (onTranscript) {
      registerTranscriptHandler((t) => onTranscript(t.role, t.text));
    }
  }, [onTranscript, registerTranscriptHandler]);

  // Register tool call handler
  useEffect(() => {
    if (onToolCall) {
      registerToolCallHandler(async (call) => {
        try {
          const response = await onToolCall(call.name, call.args);
          session.sendToolResponse(call.id, call.name, response);
        } catch (err) {
          session.sendToolResponse(call.id, call.name, {
            error: err instanceof Error ? err.message : "Tool execution failed",
          });
        }
      });
    }
  }, [onToolCall, registerToolCallHandler, session]);

  // Enumerate devices when camera/mic is active
  useEffect(() => {
    if (isLive || isConnecting) {
      navigator.mediaDevices?.enumerateDevices().then((devs) => {
        setDevices(devs);
        const cams = devs.filter((d) => d.kind === "videoinput");
        const mics = devs.filter((d) => d.kind === "audioinput");
        if (cams.length > 0 && !selectedCamera) setSelectedCamera(cams[0].deviceId);
        if (mics.length > 0 && !selectedMic) setSelectedMic(mics[0].deviceId);
      }).catch(() => {});
    }
  }, [isLive, isConnecting, selectedCamera, selectedMic]);

  // Handle start
  const handleStart = useCallback(async () => {
    if (!videoRef.current) return;
    clearError();
    await start(videoRef.current, context, {
      camera: true,
      microphone: true,
      facingMode: "user",
    });
  }, [start, context, clearError]);

  // Handle end
  const handleEnd = useCallback(() => {
    end();
  }, [end]);

  const stateColor = STATE_COLORS[state] || "#6b7280";
  const stateLabel = STATE_LABELS[state] || state;
  const hasCamera = indicators.cameraPreview === "active";
  const hasMic = indicators.microphone === "active" || indicators.microphone === "muted";
  const hasScreen = indicators.screen === "active";

  // Collapsed view (picture-in-picture card)
  if (collapsed && (isLive || isConnecting)) {
    return (
      <div
        className="fixed bottom-20 right-4 z-50 w-64 overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur-xl"
        style={{ borderColor: `${stateColor}40` }}
      >
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
          />
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold">
            <IndicatorDot status={isLive ? "connected" : "connecting"} />
            <span style={{ color: stateColor }}>{stateLabel}</span>
          </div>
        </div>
        <div className="flex items-center justify-between p-2">
          <div className="flex gap-1">
            <ControlButton
              onClick={toggleMute}
              active={indicators.microphone === "muted"}
              title={indicators.microphone === "muted" ? "Unmute" : "Mute"}
              aria-label={indicators.microphone === "muted" ? "Unmute microphone" : "Mute microphone"}
            >
              {indicators.microphone === "muted" ? <MicOff size={16} /> : <Mic size={16} />}
            </ControlButton>
            <ControlButton
              onClick={handleEnd}
              title="End session"
              aria-label="End live session"
            >
              <PhoneOff size={16} />
            </ControlButton>
          </div>
          <ControlButton
            onClick={onToggleCollapse || (() => {})}
            title="Expand"
            aria-label="Expand live panel"
          >
            <Maximize2 size={16} />
          </ControlButton>
        </div>
      </div>
    );
  }

  // Idle state — show Start button
  if (state === "idle" || state === "ended") {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-purple-500/30 to-purple-700/30">
            <Video size={20} className="text-purple-300" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">LiTT Live</h3>
            <p className="text-[10px] text-slate-400">Real-time voice + vision session</p>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Start a Live session to let LiTT see through your camera and hear your voice.
          LiTT will respond with spoken audio and can call tools in the Studio.
        </p>
        <button
          type="button"
          onClick={handleStart}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 px-4 py-2.5 text-sm font-bold text-white transition-all hover:from-purple-500 hover:to-purple-600 active:scale-[0.98]"
        >
          <Video size={16} /> Start LiTT Live
        </button>
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
            <div className="flex items-center gap-1.5">
              <AlertCircle size={14} />
              <span>{error.message}</span>
            </div>
            {error.retryable && (
              <button
                type="button"
                onClick={handleStart}
                className="mt-1 text-[10px] font-bold underline"
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Shield size={12} />
          <span>Camera and microphone run locally. No video is stored.</span>
        </div>
      </div>
    );
  }

  // Active session — full panel
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border bg-black/60 p-3 backdrop-blur-xl"
      style={{ borderColor: `${stateColor}40` }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IndicatorDot status={isLive ? "connected" : isConnecting ? "connecting" : "error"} />
          <span className="text-xs font-bold" style={{ color: stateColor }}>
            {stateLabel}
          </span>
        </div>
        <div className="flex gap-1">
          <ControlButton
            onClick={onToggleCollapse || (() => {})}
            title="Minimize"
            aria-label="Minimize live panel"
          >
            <Minimize2 size={16} />
          </ControlButton>
        </div>
      </div>

      {/* ── Camera preview ── */}
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />
        {/* Overlay: vision status */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold">
          {indicators.littVision === "connected" ? (
            <>
              <Eye size={12} className="text-green-400" />
              <span className="text-green-400">LiTT Vision connected</span>
            </>
          ) : indicators.littVision === "connecting" ? (
            <>
              <Eye size={12} className="text-yellow-400" />
              <span className="text-yellow-400">Connecting LiTT Vision…</span>
            </>
          ) : (
            <>
              <EyeOff size={12} className="text-slate-500" />
              <span className="text-slate-500">LiTT Vision disconnected</span>
            </>
          )}
        </div>
        {/* Overlay: frame counter */}
        {indicators.frameStream === "active" && (
          <div className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-mono text-slate-400">
            {framesSent} frames
          </div>
        )}
      </div>

      {/* ── Truthful connection indicators ── */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
          <IndicatorDot status={indicators.cameraPreview} />
          <span className="text-slate-300">Camera Preview</span>
          <span className="ml-auto font-bold text-slate-400">
            {indicators.cameraPreview === "active" ? "Connected" : indicators.cameraPreview}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
          <IndicatorDot status={indicators.microphone} />
          <span className="text-slate-300">Microphone</span>
          <span className="ml-auto font-bold text-slate-400">
            {indicators.microphone === "active" ? "Listening" : indicators.microphone}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
          {indicators.littAudio === "connected" ? <Ear size={12} className="text-green-400" /> : <EarOff size={12} className="text-slate-500" />}
          <span className="text-slate-300">LiTT Voice</span>
          <span className="ml-auto font-bold text-slate-400">
            {indicators.littAudio === "connected" ? "Connected" : indicators.littAudio}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
          {indicators.littVision === "connected" ? <Eye size={12} className="text-green-400" /> : <EyeOff size={12} className="text-slate-500" />}
          <span className="text-slate-300">LiTT Vision</span>
          <span className="ml-auto font-bold text-slate-400">
            {indicators.littVision === "connected" ? "Connected" : indicators.littVision}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
          <IndicatorDot status={indicators.frameStream} />
          <span className="text-slate-300">Frame Stream</span>
          <span className="ml-auto font-bold text-slate-400">
            {indicators.frameStream === "active" ? "1 FPS" : indicators.frameStream}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
          <IndicatorDot status={indicators.screen} />
          <span className="text-slate-300">Screen</span>
          <span className="ml-auto font-bold text-slate-400">
            {indicators.screen === "active" ? "Shared" : "Not shared"}
          </span>
        </div>
      </div>

      {/* ── Transcripts ── */}
      {(userTranscript || assistantTranscript) && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/40 p-2">
          {userTranscript && (
            <div className="text-xs">
              <span className="font-bold text-purple-300">You: </span>
              <span className="text-slate-200">{userTranscript}</span>
            </div>
          )}
          {assistantTranscript && (
            <div className="text-xs">
              <span className="font-bold text-green-300">LiTT: </span>
              <span className="text-slate-200">{assistantTranscript}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Error display ── */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          <div className="flex items-center gap-1.5">
            <AlertCircle size={14} />
            <span>{error.message}</span>
          </div>
          <div className="mt-1 flex gap-2">
            {error.retryable && (
              <button
                type="button"
                onClick={() => { clearError(); void reconnect(); }}
                className="text-[10px] font-bold underline"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowErrorDetails(!showErrorDetails)}
              className="text-[10px] font-bold underline"
            >
              {showErrorDetails ? "Hide" : "Details"}
            </button>
          </div>
          {showErrorDetails && (
            <div className="mt-1 font-mono text-[10px] text-red-400/70">
              Kind: {error.kind} | Retryable: {String(error.retryable)}
            </div>
          )}
        </div>
      )}

      {/* ── Controls ── */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex gap-1">
          <ControlButton
            onClick={toggleMute}
            active={indicators.microphone === "muted"}
            disabled={!hasMic}
            title={indicators.microphone === "muted" ? "Unmute" : "Mute"}
            aria-label={indicators.microphone === "muted" ? "Unmute microphone" : "Mute microphone"}
          >
            {indicators.microphone === "muted" ? <MicOff size={16} /> : <Mic size={16} />}
          </ControlButton>
          <ControlButton
            onClick={toggleCamera}
            active={!hasCamera}
            disabled={!hasCamera && indicators.cameraPreview !== "active"}
            title={hasCamera ? "Turn off camera" : "Turn on camera"}
            aria-label={hasCamera ? "Turn off camera" : "Turn on camera"}
          >
            {hasCamera ? <Video size={16} /> : <VideoOff size={16} />}
          </ControlButton>
          <ControlButton
            onClick={() => void flipCamera()}
            title="Switch camera"
            aria-label="Switch between front and rear camera"
          >
            <SwitchCamera size={16} />
          </ControlButton>
          <ControlButton
            onClick={() => (hasScreen ? stopScreenShare() : void startScreenShare())}
            active={hasScreen}
            title={hasScreen ? "Stop screen share" : "Share screen"}
            aria-label={hasScreen ? "Stop screen sharing" : "Start screen sharing"}
          >
            <Monitor size={16} />
          </ControlButton>
        </div>
        <div className="flex gap-1">
          <ControlButton
            onClick={interrupt}
            title="Interrupt LiTT"
            aria-label="Interrupt LiTT while speaking"
          >
            <Activity size={16} />
          </ControlButton>
          <ControlButton
            onClick={() => void reconnect()}
            title="Reconnect"
            aria-label="Reconnect to LiTT Live"
          >
            <RefreshCw size={16} />
          </ControlButton>
          <button
            type="button"
            onClick={handleEnd}
            title="End session"
            aria-label="End live session"
            className="grid h-9 w-9 place-items-center rounded-lg border border-red-500/40 bg-red-500/20 text-red-300 transition-all hover:bg-red-500/30 active:scale-95"
          >
            <PhoneOff size={16} />
          </button>
        </div>
      </div>

      {/* ── Device selectors (toggle) ── */}
      <button
        type="button"
        onClick={() => setShowDeviceSelectors(!showDeviceSelectors)}
        className="text-left text-[10px] text-slate-500 hover:text-slate-300"
      >
        {showDeviceSelectors ? "▾" : "▸"} Device settings
      </button>
      {showDeviceSelectors && (
        <div className="flex flex-col gap-1.5">
          <select
            value={selectedCamera || ""}
            onChange={(e) => setSelectedCamera(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-[10px] text-slate-300"
            aria-label="Select camera device"
          >
            {devices.filter((d) => d.kind === "videoinput").map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Camera"}
              </option>
            ))}
          </select>
          <select
            value={selectedMic || ""}
            onChange={(e) => setSelectedMic(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-[10px] text-slate-300"
            aria-label="Select microphone device"
          >
            {devices.filter((d) => d.kind === "audioinput").map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Privacy notice ── */}
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
        <Shield size={12} />
        <span>Camera and microphone run locally. No video is stored by default.</span>
      </div>
    </div>
  );
}
