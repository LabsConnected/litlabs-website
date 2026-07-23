"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Loader2, MonitorUp, Square, X } from "lucide-react";

export default function ScreenTool() {
  const { resolvedColors: T } = useTheme();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "active" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopStream = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setStatus("idle");
    setIsRecording(false);
  }, [stream]);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  const startScreen = useCallback(async () => {
    setStatus("requesting");
    setError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      setStream(s);
      setStatus("active");
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play().catch(() => {});
      }
      s.getVideoTracks()[0].addEventListener("ended", stopStream);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Screen capture failed");
    }
  }, [stopStream]);

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
      <div className="shrink-0 border-b border-white/10 p-3">
        <div className="flex items-center gap-2">
          <MonitorUp size={14} style={{ color: T.accentColor }} />
          <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: T.accentColor }}>
            Screen Capture
          </div>
        </div>
        <p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>
          Share a window, tab, or full screen.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {status === "idle" && (
          <button
            onClick={startScreen}
            className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-300"
          >
            <MonitorUp size={14} /> Start screen capture
          </button>
        )}
        {status === "requesting" && (
          <div className="flex items-center gap-2 text-xs text-cyan-300">
            <Loader2 size={16} className="animate-spin" /> Requesting screen access…
          </div>
        )}
        {status === "error" && (
          <div className="space-y-2 text-xs text-red-200">
            <div className="flex items-center gap-2 font-bold">
              <X size={14} /> Screen capture unavailable
            </div>
            <p>{error || "Could not access screen selection."}</p>
            <button
              onClick={startScreen}
              className="rounded-full border border-red-400/30 px-3 py-1 text-red-200"
            >
              Try again
            </button>
          </div>
        )}
        {status === "active" && (
          <div className="space-y-2">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-xl border border-white/10 bg-black"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsRecording((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-[10px] font-bold text-white"
              >
                {isRecording ? <Square size={12} /> : <MonitorUp size={12} />}
                {isRecording ? "Stop recording" : "Start recording"}
              </button>
              <button
                onClick={stopStream}
                className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-[10px] font-bold text-white"
              >
                <X size={12} /> Stop sharing
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
