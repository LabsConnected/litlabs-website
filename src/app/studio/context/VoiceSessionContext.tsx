"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sanitizeSpeech } from "@/features/voice/lib/sanitizeSpeech";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { createInitialTimingMetrics, computeLatencies, type VoiceTimingMetrics } from "@/features/voice/types";
import { useInworldSession } from "@/features/voice/hooks/useInworldSession";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceState =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "processing"
  | "assistant_speaking"
  | "muted"
  | "error";

export interface VoiceSessionCtx {
  voiceState: VoiceState;
  transcript: string;
  micLevel: number;
  errorMessage: string | null;
  isMuted: boolean;
  selectedDeviceId: string | null;
  availableDevices: MediaDeviceInfo[];
  voiceMode: "live" | "recording" | null;
  timing: VoiceTimingMetrics;
  latencies: ReturnType<typeof computeLatencies>;
  // Actions
  startVoice: () => void;
  stopVoice: () => void;
  toggleMute: () => void;
  interrupt: () => void;
  speakText: (text: string) => void;
  stopSpeaking: () => void;
  selectDevice: (deviceId: string) => void;
  setOnTurn: (handler: (text: string) => void) => void;
}

// ---------------------------------------------------------------------------
// Singleton stream guard — survives provider remounts
// ---------------------------------------------------------------------------

let activeStream: MediaStream | null = null;

// ---------------------------------------------------------------------------
// Context default
// ---------------------------------------------------------------------------

const noop = () => {};

const defaultCtx: VoiceSessionCtx = {
  voiceState: "idle",
  transcript: "",
  micLevel: 0,
  errorMessage: null,
  isMuted: false,
  selectedDeviceId: null,
  availableDevices: [],
  voiceMode: null,
  timing: createInitialTimingMetrics(),
  latencies: computeLatencies(createInitialTimingMetrics()),
  startVoice: noop,
  stopVoice: noop,
  toggleMute: noop,
  interrupt: noop,
  speakText: noop,
  stopSpeaking: noop,
  selectDevice: noop,
  setOnTurn: noop,
};

export const VoiceSessionContext = createContext<VoiceSessionCtx>(defaultCtx);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEVICE_STORAGE_KEY = "litt:voice:deviceId";

export function VoiceSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // --- State ---
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      return localStorage.getItem(DEVICE_STORAGE_KEY);
    },
  );
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [voiceMode, setVoiceMode] = useState<"live" | "recording" | null>(null);
  const voiceStore = useVoiceStore();
  const setTiming = voiceStore.setTiming;

  // --- Refs ---
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeRef = useRef(false); // true while a session is live
  const voiceStateRef = useRef<VoiceState>("idle"); // mirror for RAF/async callbacks
  const onTurnRef = useRef<(text: string) => void>(noop);
  const submittedTranscriptRef = useRef("");
  const sessionGenerationRef = useRef(0);

  // --- Inworld session (primary voice provider) ---
  // Use refs for callbacks to avoid capturing mutable refs in hook closures
  const inworldOnTranscriptRef = useRef<(text: string, final: boolean) => void>(() => {});
  const inworldOnAgentTextRef = useRef<(delta: string) => void>(() => {});
  const inworldOnErrorRef = useRef<(msg: string) => void>(() => {});

  useEffect(() => {
    inworldOnTranscriptRef.current = (text: string, final: boolean) => {
      if (final) {
        const trimmed = text.trim();
        if (trimmed && trimmed !== submittedTranscriptRef.current && activeRef.current) {
          submittedTranscriptRef.current = trimmed;
          setTranscript(trimmed);
          setTiming({ recordingEndedAt: Date.now(), transcriptionCompletedAt: Date.now(), aiResponseStartedAt: Date.now() });
          activeRef.current = false;
          onTurnRef.current(trimmed);
          setTiming({ aiResponseCompletedAt: Date.now() });
        }
      } else {
        setTranscript(text);
      }
    };
    inworldOnAgentTextRef.current = (delta: string) => {
      setTranscript((prev) => prev + delta);
    };
    inworldOnErrorRef.current = (msg: string) => {
      setVoiceState("error");
      voiceStateRef.current = "error";
      setErrorMessage(msg);
    };
  });

  const inworldSession = useInworldSession({
    onTranscript: (text: string, final: boolean) => inworldOnTranscriptRef.current(text, final),
    onAgentText: (delta: string) => inworldOnAgentTextRef.current(delta),
    onError: (msg: string) => inworldOnErrorRef.current(msg),
  });

  // Sync Inworld connection state to voiceState
  const inworldConnectedRef = useRef(false);

  // Sync Inworld mic level to context micLevel for waveform visualization
  const inworldAudioLevel = useVoiceStore((s) => s.audioLevel);
  useEffect(() => {
    if (inworldConnectedRef.current) {
      setMicLevel(inworldAudioLevel);
    }
  }, [inworldAudioLevel]);

  // Keep voiceStateRef in sync
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  // ---------------------------------------------------------------------------
  // cleanup — fully idempotent
  // ---------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    console.debug("[Voice] cleanup called");

    // 1. Stop mic tracks
    activeStream?.getTracks().forEach((t) => t.stop());
    activeStream = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // 2. Close AudioContext
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Device enumeration
  // ---------------------------------------------------------------------------

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      setAvailableDevices(inputs);
    } catch {
      // permissions not yet granted — list will be empty
    }
  }, []);

  // On mount: enumerate devices, subscribe to devicechange
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    // Run async — state update happens inside the promise callback, not synchronously
    const run = () => {
      void enumerateDevices();
    };
    run();

    navigator.mediaDevices.addEventListener("devicechange", run);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", run);
    };
  }, [enumerateDevices]);

  // ---------------------------------------------------------------------------
  // startVoice
  // ---------------------------------------------------------------------------

  const startVoice = useCallback(async () => {
    const current = voiceStateRef.current;
    if (current !== "idle" && current !== "error") {
      console.debug(
        "[Voice] startVoice ignored — already active, state:",
        current,
      );
      return;
    }

    console.debug("[Voice] session start");
    setVoiceState("requesting_permission");
    voiceStateRef.current = "requesting_permission";
    setErrorMessage(null);
    setTranscript("");
    setIsMuted(false);
    submittedTranscriptRef.current = "";
    setTiming({ recordingStartedAt: Date.now() });

    // Always clean up before starting
    activeRef.current = false;
    sessionGenerationRef.current += 1;
    const generation = sessionGenerationRef.current;
    cleanup();

    // Check microphone availability (without acquiring — Inworld will acquire it)
    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = "This browser cannot access microphones. Use a current version of Chrome, Edge, or Firefox.";
      setVoiceState("error");
      voiceStateRef.current = "error";
      setErrorMessage(msg);
      return;
    }

    // --- Inworld is the only voice provider ---
    // Inworld handles STT + LLM + TTS. It acquires the microphone internally
    // via startMicCapture(). We no longer do a redundant getUserMedia here.
    setVoiceState("connecting");
    voiceStateRef.current = "connecting";

    try {
      console.debug("[Voice] starting Inworld session");
      await inworldSession.startListening();

      // Invalidate if user stopped voice while connecting
      if (generation !== sessionGenerationRef.current) {
        inworldSession.stopListening();
        inworldSession.disconnect();
        return;
      }

      inworldConnectedRef.current = true;
      activeRef.current = true;
      setVoiceMode("live");
      setVoiceState("listening");
      voiceStateRef.current = "listening";
      console.debug("[Voice] Inworld session connected");

      // Enumerate devices after permission was granted by startMicCapture
      await enumerateDevices();
    } catch (inworldErr) {
      console.warn("[Voice] Inworld failed:", inworldErr);
      inworldConnectedRef.current = false;
      const msg = inworldErr instanceof Error ? inworldErr.message : "Voice connection failed.";
      setVoiceState("error");
      voiceStateRef.current = "error";
      setErrorMessage(msg);
      cleanup();
    }
  }, [cleanup, enumerateDevices, inworldSession, setTiming]);

  // ---------------------------------------------------------------------------
  // stopVoice
  // ---------------------------------------------------------------------------

  const stopVoice = useCallback(() => {
    console.debug("[Voice] stopVoice");
    // Disconnect Inworld if active
    if (inworldConnectedRef.current) {
      inworldSession.stopListening();
      inworldSession.disconnect();
      inworldConnectedRef.current = false;
    }
    activeRef.current = false;
    sessionGenerationRef.current += 1;
    setVoiceState("idle");
    voiceStateRef.current = "idle";
    cleanup();
    setTranscript("");
    setMicLevel(0);
    setVoiceMode(null);
    submittedTranscriptRef.current = "";
  }, [cleanup, inworldSession]);

  // ---------------------------------------------------------------------------
  // toggleMute
  // ---------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        setVoiceState("muted");
        voiceStateRef.current = "muted";
      } else {
        setVoiceState("listening");
        voiceStateRef.current = "listening";
      }
      console.debug("[Voice] mute toggled:", next);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // stopSpeaking
  // ---------------------------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    // Inworld manages its own TTS; interrupt() handles stopping via inworldSession.interrupt()
  }, []);

  // ---------------------------------------------------------------------------
  // speakText
  // ---------------------------------------------------------------------------

  const speakText = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      const sanitized = sanitizeSpeech(text);
      if (!sanitized) return;

      // If Inworld is connected, use it for TTS (uses the configured Inworld voice)
      if (inworldConnectedRef.current) {
        inworldSession.speakText(sanitized);
        setVoiceState("assistant_speaking");
        voiceStateRef.current = "assistant_speaking";
        return;
      }

      // Inworld not connected — can't speak
      console.warn("[Voice] speakText called but Inworld is not connected");
      setVoiceState("error");
      voiceStateRef.current = "error";
      setErrorMessage("Voice session is not active. Start a voice session first.");
    },
    [stopSpeaking, setTiming, inworldSession, voiceStore.activeAgent],
  );

  // ---------------------------------------------------------------------------
  // interrupt
  // ---------------------------------------------------------------------------

  const interrupt = useCallback(() => {
    console.debug("[Voice] interrupt");
    stopSpeaking();
    if (inworldConnectedRef.current) {
      inworldSession.interrupt();
      return;
    }
  }, [stopSpeaking, inworldSession]);

  // ---------------------------------------------------------------------------
  // selectDevice
  // ---------------------------------------------------------------------------

  const selectDevice = useCallback(
    (deviceId: string) => {
      localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
      setSelectedDeviceId(deviceId);
      // If currently active, restart with new device
      if (activeRef.current) {
        stopVoice();
        // Small delay to let cleanup finish before restarting
        setTimeout(() => startVoice(), 300);
      }
    },
    [stopVoice, startVoice],
  );

  const setOnTurn = useCallback((handler: (text: string) => void) => {
    onTurnRef.current = handler;
  }, []);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      activeRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const latencies = useMemo(
    () => computeLatencies(voiceStore.timing),
    [voiceStore.timing],
  );

  const ctx = useMemo<VoiceSessionCtx>(
    () => ({
      voiceState,
      transcript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      voiceMode,
      timing: voiceStore.timing,
      latencies,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
    }),
    [
      voiceState,
      transcript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      voiceMode,
      voiceStore.timing,
      latencies,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
    ],
  );

  return (
    <VoiceSessionContext.Provider value={ctx}>
      {children}
    </VoiceSessionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceSession(): VoiceSessionCtx {
  return useContext(VoiceSessionContext);
}
