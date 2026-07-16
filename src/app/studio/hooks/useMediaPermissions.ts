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
}

export async function requestCameraStream(
  facingMode: "user" | "environment" = "user",
): Promise<MediaStream> {
  if (typeof window === "undefined" || !window.isSecureContext) {
    throw new DOMException(
      "Camera access requires a secure HTTPS connection.",
      "SecurityError",
    );
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException(
      "Camera access is not supported in this browser.",
      "NotSupportedError",
    );
  }

  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
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
      const denied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "PermissionDeniedError");
      const err: MediaPermissionError = {
        type: "audio",
        message: denied
          ? "Microphone permission was denied. Please allow access in your browser settings."
          : `Microphone error: ${e instanceof Error ? e.message : String(e)}`,
      };
      setLastError(err);
      setPermission((p) => ({ ...p, audio: denied ? "denied" : "error" }));
      return null;
    }
  }, []);

  const requestVideo = useCallback(async (
    facingMode: "user" | "environment" = "user",
  ): Promise<MediaStream | null> => {
    setLastError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const err: MediaPermissionError = {
        type: "video",
        message: "Camera access is not supported in this browser.",
      };
      setLastError(err);
      setPermission((p) => ({ ...p, video: "error" }));
      return null;
    }
    try {
      const stream = await requestCameraStream(facingMode);
      setPermission((p) => ({ ...p, video: "granted" }));
      return stream;
    } catch (e) {
      const denied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "PermissionDeniedError");
      const err: MediaPermissionError = {
        type: "video",
        message: denied
          ? "Camera permission was denied. Please allow access in your browser settings."
          : e instanceof Error
            ? e.message
            : `Camera error: ${String(e)}`,
      };
      setLastError(err);
      setPermission((p) => ({ ...p, video: denied ? "denied" : "error" }));
      return null;
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
    resetPermission,
  };
}
