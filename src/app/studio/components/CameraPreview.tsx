"use client";

/**
 * CameraPreview — compact camera popover that opens above the composer.
 *
 * Shows a live camera preview with three actions:
 *   - Capture photo → attaches to the current message via addCameraPhoto
 *   - Switch camera → cycles through available video devices
 *   - Close → stops the stream and closes the preview
 *
 * Does NOT claim LiTT can see the user. This is just a capture tool.
 * Live vision is handled by the Live Voice overlay.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, SwitchCamera, X, AlertCircle, Loader2 } from "lucide-react";

export interface CameraPreviewProps {
  onClose: () => void;
  onCapture: (file: File) => void;
}

type PreviewStatus =
  | "idle"
  | "requesting_permission"
  | "live"
  | "capturing"
  | "permission_denied"
  | "no_device"
  | "device_busy"
  | "unsupported"
  | "error";

const STATUS_LABELS: Record<PreviewStatus, string> = {
  idle: "Camera off",
  requesting_permission: "Requesting camera permission…",
  live: "Camera preview active",
  capturing: "Capturing…",
  permission_denied: "Camera permission denied",
  no_device: "No camera found",
  device_busy: "Camera is busy",
  unsupported: "Camera not supported in this browser",
  error: "Camera error",
};

export default function CameraPreview({ onClose, onCapture }: CameraPreviewProps) {
  const [status, setStatus] = useState<PreviewStatus>("requesting_permission");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async (deviceId?: string, mode?: "user" | "environment") => {
    setStatus("requesting_permission");
    setErrorMsg(null);
    stopStream();

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorMsg("This browser cannot access the camera.");
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: mode ?? facingMode },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
      setStatus("live");

      // Enumerate devices after permission is granted
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices.filter((d) => d.kind === "videoinput");
        setDevices(videoInputs);
      } catch {
        // enumeration may fail on some browsers
      }
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setStatus("permission_denied");
        setErrorMsg("Camera permission was denied. Allow access in your browser settings.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setStatus("no_device");
        setErrorMsg("No camera was detected on this device.");
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setStatus("device_busy");
        setErrorMsg("Another application is using the camera.");
      } else {
        setStatus("error");
        setErrorMsg(err.message || String(e));
      }
    }
  }, [facingMode, stopStream]);

  // Start camera on mount
  useEffect(() => {
    void startCamera();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle track ended (device disconnected)
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    const handleEnded = () => {
      setStatus("error");
      setErrorMsg("The camera stream ended unexpectedly.");
    };
    tracks.forEach((t) => t.addEventListener("ended", handleEnded));
    return () => tracks.forEach((t) => t.removeEventListener("ended", handleEnded));
  }, [status]);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    setStatus("capturing");
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setStatus("error");
      setErrorMsg("Could not capture image.");
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("error");
        setErrorMsg("Capture produced no image data.");
        return;
      }
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      onCapture(file);
      setStatus("live");
    }, "image/jpeg", 0.85);
  }, [onCapture]);

  const switchCamera = useCallback(() => {
    // If we have multiple devices, cycle to the next one
    if (devices.length > 1) {
      const currentIndex = devices.findIndex((d) => d.deviceId === selectedDeviceId);
      const nextDevice = devices[(currentIndex + 1) % devices.length];
      setSelectedDeviceId(nextDevice.deviceId);
      void startCamera(nextDevice.deviceId);
    } else {
      // Only one device — toggle facing mode
      const next = facingMode === "user" ? "environment" : "user";
      setFacingMode(next);
      void startCamera(undefined, next);
    }
  }, [devices, selectedDeviceId, facingMode, startCamera]);

  return (
    <div
      className="fixed bottom-20 right-4 z-[10015] flex w-72 flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
      role="dialog"
      aria-label="Camera preview"
      data-testid="camera-preview"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
        <Camera size={12} className="pointer-events-none" style={{ color: "var(--text-muted)" }} />
        <span className="flex-1 text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
          Camera
        </span>
        <button
          type="button"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded hover:bg-white/10"
          style={{ color: "var(--text-muted)" }}
          aria-label="Close camera preview"
        >
          <X size={14} className="pointer-events-none" />
        </button>
      </div>

      {/* Video preview */}
      <div className="relative aspect-video min-h-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: facingMode === "user" ? "scaleX(-1)" : undefined }}
          data-testid="camera-video"
        />
        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Status overlay */}
        {status !== "live" && status !== "capturing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
            {status === "requesting_permission" ? (
              <Loader2 size={20} className="animate-spin text-white/60" />
            ) : (
              <AlertCircle size={20} className="text-red-400" />
            )}
            <span className="px-4 text-center text-[10px] font-bold text-white/70">
              {STATUS_LABELS[status]}
            </span>
            {errorMsg && (
              <span className="px-4 text-center text-[9px] text-white/50">{errorMsg}</span>
            )}
            {(status === "permission_denied" || status === "error") && (
              <button
                type="button"
                onClick={() => void startCamera()}
                className="mt-1 rounded bg-white/10 px-3 py-1 text-[10px] font-bold text-white hover:bg-white/20"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* Recording indicator dot */}
        {status === "live" && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-[8px] font-bold uppercase text-white/80">Live</span>
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex shrink-0 items-center justify-between gap-1.5 border-t px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
        {/* Switch camera */}
        <button
          type="button"
          onClick={switchCamera}
          disabled={status !== "live"}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition hover:bg-white/10 disabled:opacity-40"
          style={{ color: "var(--text-secondary)" }}
          aria-label="Switch camera"
          title="Switch camera"
        >
          <SwitchCamera size={14} className="pointer-events-none" />
          <span className="hidden sm:inline">Switch</span>
        </button>

        {/* Capture */}
        <button
          type="button"
          onClick={capturePhoto}
          disabled={status !== "live"}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold text-black transition active:scale-95 disabled:opacity-40"
          style={{ backgroundColor: "var(--litt-primary)" }}
          aria-label="Capture photo"
          title="Capture photo and attach to message"
          data-testid="camera-capture"
        >
          <Camera size={14} className="pointer-events-none" />
          Capture
        </button>

        {/* Device selector (if multiple cameras) */}
        {devices.length > 1 && (
          <select
            value={selectedDeviceId ?? ""}
            onChange={(e) => {
              setSelectedDeviceId(e.target.value);
              void startCamera(e.target.value);
            }}
            className="max-w-20 truncate rounded bg-transparent text-[9px] outline-none"
            style={{ color: "var(--text-muted)" }}
            aria-label="Select camera device"
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId} className="bg-black text-white">
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
