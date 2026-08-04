"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, Video, Monitor, X, Square, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecordingMode = "audio" | "video" | "screen" | null;

interface MediaRecorderState {
  mode: RecordingMode;
  recording: boolean;
  error: string | null;
  seconds: number;
}

// ---------------------------------------------------------------------------
// Component — renders as a floating panel above the composer
// ---------------------------------------------------------------------------

export interface MediaRecorderPanelProps {
  mode: RecordingMode;
  onClose: () => void;
  onComplete: (file: File, source: "record-audio" | "record-video" | "screen") => void;
}

export default function MediaRecorderPanel({ mode, onClose, onComplete }: MediaRecorderPanelProps) {
  const [state, setState] = useState<MediaRecorderState>({
    mode,
    recording: false,
    error: null,
    seconds: 0,
  });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  // Cleanup — declared before startRecording/stopRecording since they reference it
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setState((prev) => ({ ...prev, recording: false }));
  }, []);

  // Start recording when mode is set
  const startRecording = useCallback(async () => {
    if (!mode) return;
    chunksRef.current = [];
    setState({ mode, recording: false, error: null, seconds: 0 });

    try {
      let stream: MediaStream;

      if (mode === "audio") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else if (mode === "video") {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } else {
        // Screen capture
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      }

      streamRef.current = stream;

      // Show video preview if applicable
      if ((mode === "video" || mode === "screen") && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        void videoPreviewRef.current.play().catch(() => {});
      }

      // Determine mime type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || "video/webm",
        });
        const ext = mode === "audio" ? "webm" : "webm";
        const file = new File([blob], `recording_${Date.now()}.${ext}`, {
          type: blob.type || (mode === "audio" ? "audio/webm" : "video/webm"),
        });
        const source = mode === "audio" ? "record-audio" : mode === "video" ? "record-video" : "screen";
        onComplete(file, source);
        cleanup();
      };

      recorder.start(1000); // collect data every second
      setState((prev) => ({ ...prev, recording: true }));

      // Start timer
      timerRef.current = setInterval(() => {
        setState((prev) => ({ ...prev, seconds: prev.seconds + 1 }));
      }, 1000);

      // Handle screen capture user-initiated stop
      if (mode === "screen") {
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          stopRecording();
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to access media device";
      setState((prev) => ({ ...prev, error: message, recording: false }));
    }
  }, [mode, onComplete, cleanup, stopRecording]);

  const handleCancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // Don't trigger onstop — we're canceling
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  // Auto-start when mode changes
  useEffect(() => {
    if (mode) {
      void startRecording();
    }
    return () => {
      cleanup();
    };
  }, [mode, startRecording, cleanup]);

  if (!mode) return null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const modeLabel = mode === "audio" ? "Audio Recording" : mode === "video" ? "Video Recording" : "Screen Capture";
  const ModeIcon = mode === "audio" ? Mic : mode === "video" ? Video : Monitor;

  return (
    <div
      className="fixed z-[10010] flex flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
        bottom: 80,
        left: "50%",
        transform: "translateX(-50%)",
        width: mode === "audio" ? 320 : 480,
        maxWidth: "calc(100vw - 32px)",
      }}
      data-testid="media-recorder-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
        <div className="flex items-center gap-2">
          <ModeIcon size={14} className="pointer-events-none" style={{ color: state.recording ? "#ef4444" : "var(--text-muted)" }} />
          <span className="text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
            {modeLabel}
          </span>
          {state.recording && (
            <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: "#ef4444" }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              REC {formatTime(state.seconds)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCancel}
          className="grid h-6 w-6 place-items-center rounded-lg hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
          aria-label="Close recorder"
        >
          <X size={14} className="pointer-events-none" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col items-center justify-center gap-3 p-4">
        {state.error ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertCircle size={24} className="pointer-events-none" style={{ color: "#fca5a5" }} />
            <p className="text-[11px]" style={{ color: "#fca5a5" }}>
              {state.error}
            </p>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Video preview */}
            {(mode === "video" || mode === "screen") && (
              <video
                ref={videoPreviewRef}
                className="w-full rounded-lg border"
                style={{
                  borderColor: "var(--studio-border)",
                  maxHeight: 240,
                  backgroundColor: "rgba(0,0,0,0.3)",
                }}
                muted
                playsInline
              />
            )}

            {/* Audio visualization */}
            {mode === "audio" && (
              <div className="flex h-16 items-center justify-center gap-1">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full transition-all"
                    style={{
                      height: state.recording ? `${20 + Math.sin(Date.now() / 200 + i) * 15 + Math.random() * 10}px` : "4px",
                      backgroundColor: state.recording ? "#22d3ee" : "var(--text-muted)",
                    }}
                  />
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex gap-2">
              {state.recording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="flex items-center gap-2 rounded-xl border px-4 py-2 text-[11px] font-bold transition hover:bg-white/5"
                  style={{
                    borderColor: "rgba(239,68,68,0.3)",
                    backgroundColor: "rgba(239,68,68,0.1)",
                    color: "#fca5a5",
                  }}
                >
                  <Square size={12} className="pointer-events-none" />
                  Stop &amp; Attach
                </button>
              ) : (
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Starting…
                </div>
              )}
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-xl border px-3 py-2 text-[11px] font-bold transition hover:bg-white/5"
                style={{ borderColor: "var(--studio-border-strong)", color: "var(--text-muted)" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
