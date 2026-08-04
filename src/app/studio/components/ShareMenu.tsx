"use client";

/**
 * ShareMenu — replaces the old broadcast icon with a real Share menu.
 *
 * Options:
 *   - Share screen (full screen)
 *   - Share application window
 *   - Share browser tab
 *   - Include system audio (toggle)
 *   - Start Live Voice (delegates to onToggleLive)
 *   - Stop sharing
 *
 * Uses navigator.mediaDevices.getDisplayMedia with appropriate constraints.
 * Shows a visible sharing indicator while active.
 * Auto-cleans up when the browser ends the stream.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Monitor,
  AppWindow,
  Globe,
  Volume2,
  VolumeX,
  Radio,
  Square,
  X,
  AlertCircle,
  Loader2,
} from "lucide-react";

export interface ShareMenuProps {
  onClose: () => void;
  onToggleLive: () => void;
  onStreamChange?: (stream: MediaStream | null) => void;
}

type ShareTarget = "monitor" | "window" | "tab";
type ShareStatus = "idle" | "requesting" | "sharing" | "error" | "unsupported";

export default function ShareMenu({ onClose, onToggleLive, onStreamChange }: ShareMenuProps) {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [includeAudio, setIncludeAudio] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<ShareTarget | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const stopSharing = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus("idle");
    setActiveTarget(null);
    onStreamChange?.(null);
  }, [onStreamChange]);

  const startSharing = useCallback(async (target: ShareTarget) => {
    setStatus("requesting");
    setErrorMsg(null);
    stopSharing();

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("unsupported");
      setErrorMsg("Screen sharing is not supported in this browser.");
      return;
    }

    try {
      // displayMediaOptions — the browser controls which screen/window/tab
      // the user picks. We set the preferred surface as a hint.
      const constraints: DisplayMediaStreamOptions = {
        video: {
          displaySurface: target === "monitor" ? "monitor" : target === "window" ? "window" : "browser",
        } as MediaTrackConstraints,
        audio: includeAudio,
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      streamRef.current = stream;
      setActiveTarget(target);
      setStatus("sharing");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }

      onStreamChange?.(stream);

      // Auto-cleanup when the user stops sharing via browser UI
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          stopSharing();
        });
      });
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setStatus("idle");
        // User cancelled — don't show an error, just go back to menu
      } else {
        setStatus("error");
        setErrorMsg(err.message || String(e));
      }
    }
  }, [includeAudio, stopSharing, onStreamChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopSharing();
  }, [stopSharing]);

  return (
    <div
      className="fixed bottom-20 right-4 z-[10015] flex w-72 flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
      role="dialog"
      aria-label="Share menu"
      data-testid="share-menu"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
        <Radio size={12} className="pointer-events-none" style={{ color: "var(--text-muted)" }} />
        <span className="flex-1 text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
          Share
        </span>
        <button
          type="button"
          onClick={() => { stopSharing(); onClose(); }}
          className="grid h-6 w-6 place-items-center rounded hover:bg-white/10"
          style={{ color: "var(--text-muted)" }}
          aria-label="Close share menu"
        >
          <X size={14} className="pointer-events-none" />
        </button>
      </div>

      {/* Sharing indicator + preview */}
      {status === "sharing" && (
        <div className="relative aspect-video min-h-0 overflow-hidden bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
            data-testid="share-preview"
          />
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-[8px] font-bold uppercase text-white/80">
              Sharing {activeTarget}
            </span>
          </span>
        </div>
      )}

      {/* Menu options */}
      <div className="flex flex-col gap-0.5 p-2">
        {status === "sharing" ? (
          <>
            {/* Stop sharing */}
            <button
              type="button"
              onClick={stopSharing}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "#ef4444" }}
              aria-label="Stop sharing"
              data-testid="stop-sharing"
            >
              <Square size={14} className="pointer-events-none" />
              Stop sharing
            </button>

            {/* Start Live Voice */}
            <div className="my-1 h-px" style={{ backgroundColor: "var(--studio-border)" }} />
            <button
              type="button"
              onClick={() => { onToggleLive(); }}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "#a855f7" }}
              aria-label="Start Live Voice"
            >
              <Radio size={14} className="pointer-events-none" />
              Start Live Voice
            </button>
          </>
        ) : status === "requesting" ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={14} className="animate-spin" />
            Requesting permission…
          </div>
        ) : status === "unsupported" || status === "error" ? (
          <div className="flex flex-col items-center gap-2 px-3 py-3">
            <AlertCircle size={18} className="text-red-400" />
            <span className="text-center text-[10px] font-bold text-red-400">
              {status === "unsupported" ? "Screen sharing not supported" : errorMsg || "Sharing error"}
            </span>
          </div>
        ) : (
          <>
            {/* Share options */}
            <button
              type="button"
              onClick={() => void startSharing("monitor")}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Share full screen"
              data-testid="share-screen"
            >
              <Monitor size={14} className="pointer-events-none" />
              Share screen
            </button>
            <button
              type="button"
              onClick={() => void startSharing("window")}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Share application window"
              data-testid="share-window"
            >
              <AppWindow size={14} className="pointer-events-none" />
              Share window
            </button>
            <button
              type="button"
              onClick={() => void startSharing("tab")}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Share browser tab"
              data-testid="share-tab"
            >
              <Globe size={14} className="pointer-events-none" />
              Share tab
            </button>

            {/* Include system audio toggle */}
            <button
              type="button"
              onClick={() => setIncludeAudio((v) => !v)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: includeAudio ? "#65f4ff" : "var(--text-muted)" }}
              aria-label="Toggle system audio"
              data-testid="toggle-audio"
            >
              {includeAudio ? <Volume2 size={14} className="pointer-events-none" /> : <VolumeX size={14} className="pointer-events-none" />}
              {includeAudio ? "System audio on" : "System audio off"}
            </button>

            <div className="my-1 h-px" style={{ backgroundColor: "var(--studio-border)" }} />

            {/* Start Live Voice */}
            <button
              type="button"
              onClick={() => { onToggleLive(); onClose(); }}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "#a855f7" }}
              aria-label="Start Live Voice"
            >
              <Radio size={14} className="pointer-events-none" />
              Start Live Voice
            </button>
          </>
        )}
      </div>
    </div>
  );
}
