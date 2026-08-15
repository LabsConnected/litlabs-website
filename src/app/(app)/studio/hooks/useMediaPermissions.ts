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
    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 24, max: 30 },
            },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
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
