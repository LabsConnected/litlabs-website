"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Camera,
  RefreshCw,
  Aperture,
  Zap,
  ScanFace,
  Pause,
  Play,
  VideoOff,
  AlertTriangle,
} from "lucide-react";
import { useMediaPermissions, type CameraDevice } from "../hooks/useMediaPermissions";

export type CameraStatus =
  | "idle"
  | "requesting_permission"
  | "starting"
  | "live"
  | "paused"
  | "capturing"
  | "analyzing"
  | "permission_denied"
  | "no_device"
  | "device_busy"
  | "unsupported"
  | "error";

interface CameraSessionProps {
  onSnapshot?: (dataUrl: string) => void;
  onClose?: () => void;
  modelName?: string;
}

const STATUS_LABELS: Record<CameraStatus, string> = {
  idle: "Camera off",
  requesting_permission: "Requesting permission…",
  starting: "Starting camera…",
  live: "Camera live",
  paused: "Camera paused",
  capturing: "Capturing…",
  analyzing: "Analyzing…",
  permission_denied: "Permission required",
  no_device: "No camera found",
  device_busy: "Camera busy",
  unsupported: "Camera unsupported",
  error: "Camera error",
};

export default function CameraSession({
  onSnapshot,
  onClose,
  modelName = "Gemini 2.5 Flash Vision",
}: CameraSessionProps) {
  const { lastError, requestVideo, enumerateCameras, resetPermission } =
    useMediaPermissions();
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(
    undefined,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const onTrackEnded = useCallback(() => {
    setStatus("error");
    setErrorMsg("The camera stream ended unexpectedly.");
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
      track.removeEventListener("ended", onTrackEnded);
    });
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [onTrackEnded]);

  const startCamera = useCallback(
    async (
      mode: "user" | "environment" = facingMode,
      deviceId?: string,
    ) => {
      setErrorMsg(null);
      setStatus("requesting_permission");

      stopStream();

      const stream = await requestVideo(mode, deviceId);
      if (!stream) {
        if (lastError) {
          setStatus(lastError.code as CameraStatus);
          setErrorMsg(lastError.message);
        } else {
          setStatus("error");
          setErrorMsg("Could not access the camera.");
        }
        return;
      }

      setStatus("starting");
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stopStream();
        setStatus("error");
        setErrorMsg("Camera video element is unavailable.");
        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      try {
        await video.play();
      } catch {
        stopStream();
        setStatus("error");
        setErrorMsg("Video playback failed to start.");
        return;
      }

      const track = stream.getVideoTracks()[0];

      if (
        !track ||
        track.readyState !== "live" ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        stopStream();
        setStatus("error");
        setErrorMsg("Camera started but no video frames were received.");
        return;
      }

      track.addEventListener("ended", onTrackEnded);

      const cams = await enumerateCameras();
      setDevices(cams);

      setStatus("live");
    },
    [facingMode, requestVideo, stopStream, enumerateCameras, lastError, onTrackEnded],
  );

  const flipCamera = useCallback(async () => {
    stopStream();
    const nextMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextMode);
    setSelectedDeviceId(undefined);
    await startCamera(nextMode);
  }, [facingMode, startCamera, stopStream]);

  const pausePreview = useCallback(() => {
    const video = videoRef.current;
    if (video && status === "live") {
      video.pause();
      setStatus("paused");
    }
  }, [status]);

  const resumePreview = useCallback(() => {
    const video = videoRef.current;
    if (video && status === "paused") {
      video.play().catch(() => {});
      setStatus("live");
    }
  }, [status]);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  useEffect(() => {
    const handler = () => {
      if (streamRef.current) {
        stopStream();
        setStatus("idle");
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [stopStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    setStatus("capturing");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setStatus("live");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    onSnapshot?.(dataUrl);
    setStatus("live");
  }, [onSnapshot]);

  const close = useCallback(() => {
    stopStream();
    resetPermission("video");
    setStatus("idle");
    setErrorMsg(null);
    onClose?.();
  }, [onClose, resetPermission, stopStream]);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      await startCamera(facingMode, deviceId);
    },
    [facingMode, startCamera],
  );

  // ── Idle state ──
  if (status === "idle") {
    return (
      <div className="flex flex-col gap-2 p-3">
        <button
          onClick={() => void startCamera()}
          className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-300 transition-all hover:bg-cyan-400/20"
        >
          <Camera size={14} /> Start camera
        </button>
        <p className="text-[9px] text-slate-500">
          Camera access requires explicit permission and runs locally in your browser.
        </p>
      </div>
    );
  }

  // ── Requesting permission ──
  if (status === "requesting_permission") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-xs text-cyan-300">
        <Aperture size={16} className="animate-spin" />
        Requesting camera permission…
      </div>
    );
  }

  // ── Starting ──
  if (status === "starting") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-xs text-cyan-300">
        <Aperture size={16} className="animate-spin" />
        Starting camera…
      </div>
    );
  }

  // ── Error states ──
  const errorStates: CameraStatus[] = [
    "permission_denied",
    "no_device",
    "device_busy",
    "unsupported",
    "error",
  ];
  if (errorStates.includes(status)) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-xs text-red-200">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle size={14} /> {STATUS_LABELS[status]}
        </div>
        <p>{errorMsg || lastError?.message || "Could not access the camera."}</p>
        <div className="flex gap-2">
          <button
            onClick={() => void startCamera()}
            className="rounded-full bg-red-400/20 px-3 py-1 text-red-200 transition-all hover:bg-red-400/30"
          >
            Try again
          </button>
          <button
            onClick={close}
            className="rounded-full border border-red-400/30 px-3 py-1 text-red-200 transition-all hover:bg-red-400/10"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // ── Live or paused ──
  const cameraLabel = facingMode === "user" ? "Front" : "Rear";
  const isLive = status === "live";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-400/30 bg-black/80 shadow-2xl">
      {/* Header overlay — honest status */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-linear-to-b from-black/80 to-transparent px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${isLive ? "bg-red-500 animate-pulse" : "bg-slate-500"}`}
          />
          <span
            className="text-[10px] font-black uppercase tracking-wider"
            style={{ color: isLive ? "#fff" : "#94a3b8" }}
          >
            {STATUS_LABELS[status]}
          </span>
          <span className="text-[10px] text-slate-300">{cameraLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ScanFace size={12} className="text-emerald-400" />
          <span className="text-[10px] font-bold text-emerald-400">
            {modelName}
          </span>
        </div>
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="aspect-video w-full object-cover"
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#0a0f1c] p-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={capture}
            disabled={!isLive}
            className="flex items-center gap-1.5 rounded-full bg-cyan-500 px-3 py-2 text-xs font-black text-black transition-all hover:bg-cyan-400 disabled:opacity-40"
            title="Capture snapshot"
          >
            <Zap size={14} /> Snapshot
          </button>
          {isLive ? (
            <button
              onClick={pausePreview}
              className="rounded-full border border-white/20 p-2 text-slate-300 transition-all hover:bg-white/10"
              title="Pause preview"
              aria-label="Pause preview"
            >
              <Pause size={14} />
            </button>
          ) : (
            <button
              onClick={resumePreview}
              className="rounded-full border border-white/20 p-2 text-slate-300 transition-all hover:bg-white/10"
              title="Resume preview"
              aria-label="Resume preview"
            >
              <Play size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Device selector */}
          {devices.length > 1 && (
            <select
              value={selectedDeviceId || ""}
              onChange={(e) => void selectDevice(e.target.value)}
              className="hidden rounded-md border border-white/20 bg-black/60 px-1.5 py-1 text-[9px] text-slate-300 sm:block"
              title="Select camera"
            >
              <option value="">Auto</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={flipCamera}
            className="rounded-full border border-white/20 p-2 text-slate-300 transition-all hover:bg-white/10"
            title="Flip camera"
            aria-label="Flip camera"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={close}
            className="rounded-full border border-white/20 p-2 text-slate-300 transition-all hover:bg-white/10"
            title="Stop camera"
            aria-label="Stop camera"
          >
            <VideoOff size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
