"use client";

/**
 * useLiTTRealtimeSession — React hook wrapping LiTTRealtimeSessionController.
 *
 * Provides reactive state for the Live session, including:
 *   - Session state (idle, connecting, live, etc.)
 *   - Connection indicators (camera, mic, LiTT audio, LiTT vision)
 *   - User and assistant transcripts
 *   - Error state
 *   - Control methods (start, end, mute, flip, screen share, etc.)
 *
 * The controller instance is stored in a ref and persists across re-renders.
 * Only ONE controller exists at a time — this is the single source of truth.
 *
 * @see src/lib/litt/live/LiTTRealtimeSessionController.ts
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiTTRealtimeSessionController,
} from "@/lib/litt/live/LiTTRealtimeSessionController";
import type {
  LiveSessionState,
  LiveConnectionIndicators,
  LiveTranscript,
  LiveToolCall,
  LiveSessionError,
  LiTTLiveSessionContext,
} from "@/lib/litt/live/types";

export interface UseLiTTRealtimeSession {
  // Reactive state
  state: LiveSessionState;
  indicators: LiveConnectionIndicators;
  userTranscript: string;
  assistantTranscript: string;
  error: LiveSessionError | null;
  isLive: boolean;
  isConnecting: boolean;
  framesSent: number;

  // Controls
  start: (videoEl: HTMLVideoElement, context: LiTTLiveSessionContext, options?: {
    camera?: boolean;
    microphone?: boolean;
    screen?: boolean;
    facingMode?: "user" | "environment";
  }) => Promise<void>;
  end: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  flipCamera: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  sendText: (text: string) => void;
  sendToolResponse: (id: string, name: string, response: Record<string, unknown>) => void;
  interrupt: () => void;
  reconnect: () => Promise<void>;
  clearError: () => void;

  // Tool call callback registration
  onToolCall: (handler: (call: LiveToolCall) => void) => void;

  // Transcript callback registration (for persistence)
  onTranscript: (handler: (transcript: LiveTranscript) => void) => void;
}

export function useLiTTRealtimeSession(): UseLiTTRealtimeSession {
  const controllerRef = useRef<LiTTRealtimeSessionController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const toolCallHandlerRef = useRef<((call: LiveToolCall) => void) | null>(null);
  const transcriptHandlerRef = useRef<((transcript: LiveTranscript) => void) | null>(null);

  const [state, setState] = useState<LiveSessionState>("idle");
  const [indicators, setIndicators] = useState<LiveConnectionIndicators>({
    cameraPreview: "inactive",
    microphone: "inactive",
    screen: "inactive",
    littAudio: "disconnected",
    littVision: "disconnected",
    frameStream: "inactive",
    agentJoined: false,
  });
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [error, setError] = useState<LiveSessionError | null>(null);
  const [framesSent, setFramesSent] = useState(0);

  // Create controller on mount (lazy init in useEffect to avoid
  // accessing refs during render — eslint-react-hooks rule).
  useEffect(() => {
    if (!controllerRef.current) {
      controllerRef.current = new LiTTRealtimeSessionController();
    }
  }, []);

  // Subscribe to controller events
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    const unsubscribe = controller.on((event) => {
      switch (event.type) {
        case "stateChange":
          setState(event.state);
          break;
        case "indicatorsChange":
          setIndicators(event.indicators);
          setFramesSent(controller.getFramesSent());
          break;
        case "userTranscript":
          setUserTranscript(event.transcript.text);
          if (event.transcript.isFinal) {
            transcriptHandlerRef.current?.(event.transcript);
            // Clear after a brief delay so the UI can show the final text
            setTimeout(() => setUserTranscript(""), 500);
          }
          break;
        case "assistantTranscript":
          setAssistantTranscript(event.transcript.text);
          if (event.transcript.isFinal) {
            transcriptHandlerRef.current?.(event.transcript);
            setTimeout(() => setAssistantTranscript(""), 500);
          }
          break;
        case "toolCall":
          toolCallHandlerRef.current?.(event.call);
          break;
        case "error":
          setError(event.error);
          break;
        case "turnComplete":
          // Transcripts are finalized in the transcript events
          break;
        case "interrupted":
          // Playback already stopped by controller
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.end();
    };
  }, []);

  const start = useCallback(async (
    videoEl: HTMLVideoElement,
    context: LiTTLiveSessionContext,
    options?: {
      camera?: boolean;
      microphone?: boolean;
      screen?: boolean;
      facingMode?: "user" | "environment";
    },
  ) => {
    videoRef.current = videoEl;
    setError(null);
    setUserTranscript("");
    setAssistantTranscript("");
    setFramesSent(0);
    await controllerRef.current?.start(videoEl, context, options);
  }, []);

  const end = useCallback(() => {
    controllerRef.current?.end();
    setState("idle");
    setUserTranscript("");
    setAssistantTranscript("");
    setError(null);
    setFramesSent(0);
  }, []);

  const toggleMute = useCallback(() => {
    controllerRef.current?.toggleMute();
  }, []);

  const toggleCamera = useCallback(() => {
    controllerRef.current?.toggleCamera();
  }, []);

  const flipCamera = useCallback(async () => {
    await controllerRef.current?.flipCamera();
  }, []);

  const startScreenShare = useCallback(async () => {
    await controllerRef.current?.startScreenShare();
  }, []);

  const stopScreenShare = useCallback(() => {
    controllerRef.current?.stopScreenShare();
  }, []);

  const sendText = useCallback((text: string) => {
    controllerRef.current?.sendText(text);
  }, []);

  const sendToolResponse = useCallback((id: string, name: string, response: Record<string, unknown>) => {
    controllerRef.current?.sendToolResponse(id, name, response);
  }, []);

  const interrupt = useCallback(() => {
    controllerRef.current?.interrupt();
  }, []);

  const reconnect = useCallback(async () => {
    setError(null);
    await controllerRef.current?.reconnectSession();
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const onToolCall = useCallback((handler: (call: LiveToolCall) => void) => {
    toolCallHandlerRef.current = handler;
  }, []);

  const onTranscript = useCallback((handler: (transcript: LiveTranscript) => void) => {
    transcriptHandlerRef.current = handler;
  }, []);

  const isLive = state === "live_audio" || state === "live_vision" || state === "live_audio_and_vision";
  const isConnecting = state === "connecting" || state === "requesting_permission" || state === "reconnecting" || state === "local_preview";

  return {
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
    sendText,
    sendToolResponse,
    interrupt,
    reconnect,
    clearError,
    onToolCall,
    onTranscript,
  };
}
