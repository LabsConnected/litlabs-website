"use client";

import { useCallback, useState } from "react";

export type PermissionState = "prompt" | "granted" | "denied" | "error";

type MediaType = "audio" | "video";

interface PermissionStatus {
  audio: PermissionState;
  video: PermissionState;
}

interface MediaPermissionError {
  type: MediaType;
  message: string;
  code: string;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

// Errors where retrying with default constraints may still succeed — e.g. a
// USB camera that doesn't expose facingMode, or a re-plugged camera whose
// exact deviceId is now stale. ConstraintNotSatisfiedError is the legacy name.
const RETRYABLE_VIDEO_ERRORS = new Set([
  "OverconstrainedError",
  "ConstraintNotSatisfiedError",
  "NotFoundError",
  "DevicesNotFoundError",
]);

export function useMediaPermissions() {
  const [permission, setPermission] = useState<PermissionStatus>({
    audio: "prompt",
    video: "prompt",
  });
  const [lastError, setLastError] = useState<MediaPermissionError | null>(null);

  const requestAudio = useCallback(async (): Promise<MediaStream | null> => {
    setLastError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const err: MediaPermissionError = {
        type: "audio",
        message: "Microphone access is not supported in this browser.",
        code: "unsupported",
      };
      setLastError(err);
      setPermission((p) => ({ ...p, audio: "error" }));
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermission((p) => ({ ...p, audio: "granted" }));
      return stream;
    } catch (e) {
      const err = e as DOMException;
      let code = "error";
      let message = `Microphone error: ${err.message || String(e)}`;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        code = "permission_denied";
        message = "Microphone permission was denied. Please allow access in your browser settings.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        code = "no_device";
        message = "No microphone was detected on this device.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        code = "device_busy";
        message = "Another application may be using the microphone.";
      }
      setLastError({ type: "audio", message, code });
      setPermission((p) => ({ ...p, audio: code === "permission_denied" ? "denied" : "error" }));
      return null;
    }
  }, []);

  const requestVideo = useCallback(async (
    facingMode: "user" | "environment" = "user",
    deviceId?: string,
  ): Promise<MediaStream | null> => {
    setLastError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const err: MediaPermissionError = {
        type: "video",
        message: "Camera access is not supported in this browser.",
        code: "unsupported",
      };
      setLastError(err);
      setPermission((p) => ({ ...p, video: "error" }));
      return null;
    }
    const openStream = (video: MediaTrackConstraints | boolean) =>
      navigator.mediaDevices.getUserMedia({ audio: false, video });

    try {
      const videoConstraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          };
      let stream: MediaStream | null = null;
      let failure: DOMException | null = null;
      try {
        stream = await openStream(videoConstraints);
      } catch (e) {
        failure = e as DOMException;
        // USB cameras that don't report a facing mode, or that were
        // unplugged/re-plugged (new deviceId), reject the requested
        // constraints — retry once with the default camera before failing.
        if (RETRYABLE_VIDEO_ERRORS.has(failure.name)) {
          try {
            stream = await openStream(true);
            failure = null;
          } catch (e2) {
            failure = e2 as DOMException;
          }
        }
      }
      if (!stream) throw failure ?? new Error("Camera stream unavailable");
      setPermission((p) => ({ ...p, video: "granted" }));
      return stream;
    } catch (e) {
      const err = e as DOMException;
      let code = "error";
      let message = `Camera error: ${err.message || String(e)}`;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        code = "permission_denied";
        message = "Camera permission was denied. Please allow access in your browser settings.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        code = "no_device";
        message = "No camera was detected on this device.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        code = "device_busy";
        message = "Another application may be using the camera.";
      }
      setLastError({ type: "video", message, code });
      setPermission((p) => ({ ...p, video: code === "permission_denied" ? "denied" : "error" }));
      return null;
    }
  }, []);

  const enumerateCameras = useCallback(async (): Promise<CameraDevice[]> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 4)}`,
        }));
    } catch {
      return [];
    }
  }, []);

  const resetPermission = useCallback((type: MediaType) => {
    setPermission((p) => ({ ...p, [type]: "prompt" }));
    setLastError(null);
  }, []);

  return {
    permission,
    lastError,
    requestAudio,
    requestVideo,
    enumerateCameras,
    resetPermission,
  };
}
