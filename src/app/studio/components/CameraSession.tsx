"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, X, Aperture, Zap, ScanFace } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useMediaPermissions } from "../hooks/useMediaPermissions";

export type CameraState = "idle" | "requesting" | "active" | "error";

interface CameraSessionProps {
  onSnapshot?: (dataUrl: string) => void;
  onClose?: () => void;
  modelName?: string;
  initialStream?: MediaStream | null;
  initialError?: string | null;
  compact?: boolean;
}

export default function CameraSession({
  onSnapshot,
  onClose,
  modelName = "Gemini 2.5 Flash Vision",
  initialStream = null,
  initialError = null,
  compact = false,
}: CameraSessionProps) {
  const { resolvedColors: T } = useTheme();
  const { lastError, requestVideo, resetPermission } = useMediaPermissions();
  const [state, setState] = useState<CameraState>(() =>
    initialStream ? "active" : initialError ? "error" : "idle",
  );
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeDeviceLabel, setActiveDeviceLabel] = useState("Camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const identifyStream = useCallback(async (stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    setSelectedDeviceId(settings?.deviceId || "");
    setActiveDeviceLabel(track?.label || "Camera");

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameraDevices(devices.filter((device) => device.kind === "videoinput"));
    } catch {
      setCameraDevices([]);
    }
  }, []);

  useEffect(() => {
    if (!initialStream) return;
    streamRef.current = initialStream;
    setState("active");
    const video = videoRef.current;
    if (video) {
      video.srcObject = initialStream;
      void video.play();
    }
    void identifyStream(initialStream);
  }, [identifyStream, initialStream]);

  useEffect(() => {
    if (initialError) setState("error");
  }, [initialError]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (
      mode: "user" | "environment" = facingMode,
      deviceId?: string,
    ) => {
      setState("requesting");
      const stream = await requestVideo(mode, deviceId);
      if (!stream) {
        setState("error");
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      await identifyStream(stream);
      setState("active");
    },
    [facingMode, identifyStream, requestVideo],
  );

  const changeCamera = useCallback(
    async (deviceId: string) => {
      if (!deviceId || deviceId === selectedDeviceId) return;
      stopStream();
      setSelectedDeviceId(deviceId);
      await startCamera(facingMode, deviceId);
    },
    [facingMode, selectedDeviceId, startCamera, stopStream],
  );

  const flipCamera = useCallback(async () => {
    stopStream();
    setSelectedDeviceId("");
    const nextMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextMode);
    await startCamera(nextMode);
  }, [facingMode, startCamera, stopStream]);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(video.videoWidth, 1280);
    canvas.height = Math.min(video.videoHeight, 720);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    onSnapshot?.(dataUrl);
  }, [onSnapshot]);

  const close = useCallback(() => {
    stopStream();
    resetPermission("video");
    setState("idle");
    onClose?.();
  }, [onClose, resetPermission, stopStream]);

  if (state === "idle") {
    return (
      <button
        onClick={() => void startCamera()}
        className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-xs font-bold"
        style={{ color: T.accentColor }}
      >
        <Camera size={14} /> Start camera
      </button>
    );
  }

  if (state === "requesting") {
    return (
      <div
        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-xs"
        style={{ color: T.accentColor }}
      >
        <Aperture size={16} className="animate-spin" />
        Requesting camera permission…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div
        className="flex flex-col gap-2 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-xs"
        style={{ color: T.warning }}
      >
        <div className="flex items-center gap-2 font-bold">
          <X size={14} /> Camera unavailable
        </div>
        <p>
          {initialError || lastError?.message || "Could not access the camera."}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => void startCamera()}
            className="rounded-full bg-red-400/20 px-3 py-1"
            style={{ color: T.warning }}
          >
            Try again
          </button>
          <button
            onClick={close}
            className="rounded-full border border-red-400/30 px-3 py-1"
            style={{ color: T.warning }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-400/30 bg-black/80 shadow-2xl">
      {/* Header overlay */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-linear-to-b from-black/80 to-transparent px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span
            className="text-[10px] font-black uppercase tracking-wider"
            style={{ color: T.textColor }}
          >
            LIVE
          </span>
          <span
            className="max-w-[120px] truncate text-[10px]"
            style={{ color: T.textMuted }}
            title={activeDeviceLabel}
          >
            {activeDeviceLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ScanFace size={12} style={{ color: T.success }} />
          <span className="text-[10px] font-bold" style={{ color: T.success }}>
            {modelName}
          </span>
        </div>
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={compact ? "aspect-[4/3] w-full object-cover" : "aspect-video w-full object-cover"}
      />

      {/* Bottom toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#0a0f1c] p-2">
        {cameraDevices.length > 0 && (
          <select
            aria-label="Camera device"
            value={selectedDeviceId}
            onChange={(event) => void changeCamera(event.target.value)}
            className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/50 px-2 py-1.5 text-[10px] text-neutral-300 outline-none focus:border-cyan-400/40"
            title={activeDeviceLabel}
          >
            {cameraDevices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={capture}
            className="flex items-center gap-1.5 rounded-full bg-cyan-500 px-3 py-2 text-xs font-black text-black hover:bg-cyan-400"
            title="Capture and attach snapshot"
          >
            <Zap size={14} /> Snapshot
          </button>
          <span
            className={compact ? "hidden" : "hidden text-[10px] sm:inline"}
            style={{ color: T.textMuted }}
          >
            Point and tap Snapshot to ask LiTT what it sees
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={flipCamera}
            className="rounded-full border border-white/20 p-2 hover:bg-white/10"
            style={{ color: T.textMuted }}
            title="Flip camera"
            aria-label="Flip camera"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={close}
            className="rounded-full border border-white/20 p-2 hover:bg-white/10"
            style={{ color: T.textMuted }}
            title="Stop camera"
            aria-label="Stop camera"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
