"use client";

/**
 * VoiceSessionContext — persistent Inworld voice session.
 *
 * ARCHITECTURE:
 * - Uses useInworldSession for STT (WebSocket → voice-server proxy → Inworld)
 * - Uses Inworld TTS (inworld-tts-2 with configured INWORLD_LITT_VOICE / INWORLD_SPARK_VOICE)
 *   when the transport is connected, falling back to browser speechSynthesis
 * - Mic track stays alive between turns (muted/unmuted, NOT stopped)
 * - State machine: ready → listening → processing → speaking → ready
 * - Only explicit "End Voice" / unmount / fatal error destroys the session
 *
 * Provider hierarchy (mounted in StudioOS.tsx):
 *   <VoiceSessionProvider>  ← this file
 *     <StudioShell>         ← tool switching happens here, voice persists
 *
 * @see src/features/voice/hooks/useInworldSession.ts
 * @see voice-server/server.mjs (WebSocket proxy to Inworld)
 */

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

export type VoiceOutputState = "idle" | "connecting" | "speaking" | "error";

export type VoiceInputState =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "listening"
  | "error";

export type MicrophoneStartSource =
  | "composer_mic_click"
  | "floating_voice_button"
  | "hands_free_resume"
  | "mount_effect"
  | "tts_started"
  | "tts_finished"
  | "session_connected"
  | "store_hydration"
  | "unknown";

export interface VoiceDiagnostics {
  provider: string;
  transportConnected: boolean;
  micActive: boolean;
  voicePhase: VoiceState;
  inputState: VoiceInputState;
  outputState: VoiceOutputState;
  lastTranscript: string | null;
  lastError: string | null;
  turnNumber: number;
}

export interface VoiceSessionCtx {
  voiceState: VoiceState;
  voiceOutputState: VoiceOutputState;
  voiceInputState: VoiceInputState;
  voiceTransportConnected: boolean;
  transcript: string;
  micLevel: number;
  errorMessage: string | null;
  isMuted: boolean;
  selectedDeviceId: string | null;
  availableDevices: MediaDeviceInfo[];
  voiceMode: "live" | "recording" | null;
  timing: VoiceTimingMetrics;
  latencies: ReturnType<typeof computeLatencies>;
  ttsEnabled: boolean;
  handsFreeEnabled: boolean;
  diagnostics: VoiceDiagnostics;
  startVoice: () => void;
  stopVoice: () => void;
  toggleMute: () => void;
  interrupt: () => void;
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  selectDevice: (deviceId: string) => void;
  setOnTurn: (handler: (text: string) => void) => void;
  toggleTts: () => void;
  toggleHandsFree: () => void;
}

// ---------------------------------------------------------------------------
// Singleton stream guard — survives provider remounts
// ---------------------------------------------------------------------------

let activeStream: MediaStream | null = null;

// ---------------------------------------------------------------------------
// Context default
// ---------------------------------------------------------------------------

const noop = () => {};

const defaultDiagnostics: VoiceDiagnostics = {
  provider: "inworld",
  transportConnected: false,
  micActive: false,
  voicePhase: "idle",
  inputState: "idle",
  outputState: "idle",
  lastTranscript: null,
  lastError: null,
  turnNumber: 0,
};

const defaultCtx: VoiceSessionCtx = {
  voiceState: "idle",
  voiceOutputState: "idle",
  voiceInputState: "idle",
  voiceTransportConnected: false,
  transcript: "",
  micLevel: 0,
  errorMessage: null,
  isMuted: false,
  selectedDeviceId: null,
  availableDevices: [],
  voiceMode: null,
  timing: createInitialTimingMetrics(),
  latencies: computeLatencies(createInitialTimingMetrics()),
  ttsEnabled: true,
  handsFreeEnabled: false,
  diagnostics: defaultDiagnostics,
  startVoice: noop,
  stopVoice: noop,
  toggleMute: noop,
  interrupt: noop,
  speakText: noop as unknown as (text: string) => Promise<void>,
  stopSpeaking: noop,
  selectDevice: noop,
  setOnTurn: noop,
  toggleTts: noop,
  toggleHandsFree: noop,
};

export const VoiceSessionContext = createContext<VoiceSessionCtx>(defaultCtx);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEVICE_STORAGE_KEY = "litt:voice:deviceId";
const TTS_PREF_KEY = "litt:voice:ttsEnabled";
const HANDS_FREE_PREF_KEY = "litt:voice:handsFreeEnabled";

export function VoiceSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // --- State ---
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceOutputState, setVoiceOutputState] = useState<VoiceOutputState>("idle");
  const [voiceInputState, setVoiceInputState] = useState<VoiceInputState>("idle");
  const [voiceTransportConnected, setVoiceTransportConnected] = useState(false);
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
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [voiceMode, setVoiceMode] = useState<"live" | "recording" | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(TTS_PREF_KEY);
    return stored === null ? true : stored === "1";
  });
  const [handsFreeEnabled, setHandsFreeEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(HANDS_FREE_PREF_KEY) === "1";
  });
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>(defaultDiagnostics);
  const voiceStore = useVoiceStore();
  const setTiming = voiceStore.setTiming;

  // --- Refs ---
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("idle");
  const voiceInputStateRef = useRef<VoiceInputState>("idle");
  const voiceOutputStateRef = useRef<VoiceOutputState>("idle");
  const onTurnRef = useRef<(text: string) => void>(noop);
  const submittedTranscriptRef = useRef("");
  const sessionGenerationRef = useRef(0);
  const micStartInProgressRef = useRef(false);
  const micActiveRef = useRef(false);
  const handsFreeEnabledRef = useRef(handsFreeEnabled);
  const ttsEnabledRef = useRef(ttsEnabled);
  const turnNumberRef = useRef(0);

  // Keep pref refs in sync
  useEffect(() => { handsFreeEnabledRef.current = handsFreeEnabled; }, [handsFreeEnabled]);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  // Update diagnostics helper
  const updateDiagnostics = useCallback((patch: Partial<VoiceDiagnostics>) => {
    setDiagnostics((prev) => ({ ...prev, ...patch }));
  }, []);

  // --- Inworld session (primary voice provider) ---
  const inworldOnTranscriptRef = useRef<(text: string, final: boolean) => void>(() => {});
  const inworldOnAgentTextRef = useRef<(delta: string) => void>(() => {});
  const inworldOnErrorRef = useRef<(msg: string) => void>(() => {});
  const inworldOnResponseCompleteRef = useRef<() => void>(() => {});

  useEffect(() => {
    inworldOnTranscriptRef.current = (text: string, final: boolean) => {
      if (final) {
        const trimmed = text.trim();
        if (trimmed && trimmed !== submittedTranscriptRef.current && activeRef.current) {
          submittedTranscriptRef.current = trimmed;
          setTranscript(trimmed);
          turnNumberRef.current += 1;
          updateDiagnostics({
            turnNumber: turnNumberRef.current,
            lastTranscript: trimmed.slice(0, 60),
          });
          setTiming({ recordingEndedAt: Date.now(), transcriptionCompletedAt: Date.now(), aiResponseStartedAt: Date.now() });
          activeRef.current = false;
          // Canonical pipeline: final transcript → onTurn → onSend →
          // /api/gemini/chat → response stored → speakText (Inworld TTS)
          onTurnRef.current(trimmed);
          setTiming({ aiResponseCompletedAt: Date.now() });
        }
      } else {
        setTranscript(text);
      }
    };
    inworldOnAgentTextRef.current = (_delta: string) => {
      // STT-only mode: Inworld's agent text is dropped. The canonical
      // assistant response comes from /api/gemini/chat via onSend.
    };
    inworldOnErrorRef.current = (msg: string) => {
      setVoiceState("error");
      voiceStateRef.current = "error";
      setVoiceOutputState("error");
      voiceOutputStateRef.current = "error";
      setVoiceInputState("error");
      voiceInputStateRef.current = "error";
      setErrorMessage(msg);
      updateDiagnostics({ lastError: msg });
    };
    inworldOnResponseCompleteRef.current = () => {
      // Inworld's auto-response finished. In STT-only mode we ignore this —
      // TTS is handled by Inworld's speakText which has its own response.done.
      setVoiceOutputState("idle");
      voiceOutputStateRef.current = "idle";
      if (voiceStateRef.current === "assistant_speaking") {
        if (handsFreeEnabledRef.current && activeRef.current) {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          setVoiceInputState("listening");
          voiceInputStateRef.current = "listening";
        } else {
          setVoiceState("idle");
          voiceStateRef.current = "idle";
        }
      }
    };
  });

  const inworldSession = useInworldSession({
    onTranscript: (text: string, final: boolean) => inworldOnTranscriptRef.current(text, final),
    onAgentText: (delta: string) => inworldOnAgentTextRef.current(delta),
    onError: (msg: string) => inworldOnErrorRef.current(msg),
    onResponseComplete: () => inworldOnResponseCompleteRef.current(),
  });

  // Sync Inworld connection state
  const inworldConnectedRef = useRef(false);

  // Sync Inworld mic level to context micLevel for waveform visualization
  const inworldAudioLevel = useVoiceStore((s) => s.audioLevel);
  useEffect(() => {
    if (inworldConnectedRef.current) {
      setMicLevel(inworldAudioLevel);
    }
  }, [inworldAudioLevel]);

  // Keep voiceStateRef in sync
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { voiceInputStateRef.current = voiceInputState; }, [voiceInputState]);
  useEffect(() => { voiceOutputStateRef.current = voiceOutputState; }, [voiceOutputState]);

  // Sync diagnostics from state
  useEffect(() => {
    updateDiagnostics({
      transportConnected: inworldConnectedRef.current,
      micActive: micActiveRef.current,
      voicePhase: voiceState,
      inputState: voiceInputState,
      outputState: voiceOutputState,
    });
  }, [voiceState, voiceInputState, voiceOutputState, updateDiagnostics]);

  // ---------------------------------------------------------------------------
  // cleanup — fully idempotent
  // ---------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    activeStream?.getTracks().forEach((t) => t.stop());
    activeStream = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
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
      // permissions not yet granted
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    const run = () => { void enumerateDevices(); };
    run();
    navigator.mediaDevices.addEventListener("devicechange", run);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", run);
    };
  }, [enumerateDevices]);

  // ---------------------------------------------------------------------------
  // requestMicrophoneStart — the SINGLE guarded entry point for mic activation
  // ---------------------------------------------------------------------------

  const logMicStart = useCallback(
    (source: MicrophoneStartSource, accepted: boolean, reason?: string) => {
      console.debug("[Voice]", { event: "microphone_start_requested", source, accepted, reason });
    },
    [],
  );

  const requestMicrophoneStart = useCallback(
    async (args: {
      source: MicrophoneStartSource;
      trustedUserGesture?: boolean;
    }): Promise<void> => {
      const { source, trustedUserGesture = false } = args;

      if (micActiveRef.current) {
        logMicStart(source, false, "already_active");
        return;
      }
      if (micStartInProgressRef.current) {
        logMicStart(source, false, "start_in_progress");
        return;
      }

      const isExplicitGesture =
        trustedUserGesture &&
        (source === "composer_mic_click" || source === "floating_voice_button");
      const isHandsFreeResume =
        source === "hands_free_resume" && handsFreeEnabledRef.current;
      if (!isExplicitGesture && !isHandsFreeResume) {
        logMicStart(source, false, "rejected_source");
        return;
      }

      logMicStart(source, true);

      micStartInProgressRef.current = true;
      const current = voiceStateRef.current;
      if (current !== "idle" && current !== "error") {
        micStartInProgressRef.current = false;
        return;
      }

      setVoiceState("requesting_permission");
      voiceStateRef.current = "requesting_permission";
      setVoiceInputState("requesting_permission");
      voiceInputStateRef.current = "requesting_permission";
      setErrorMessage(null);
      setTranscript("");
      setIsMuted(false);
      submittedTranscriptRef.current = "";
      setTiming({ recordingStartedAt: Date.now() });
      updateDiagnostics({ lastError: null });

      activeRef.current = false;
      sessionGenerationRef.current += 1;
      const generation = sessionGenerationRef.current;
      cleanup();

      if (!navigator.mediaDevices?.getUserMedia) {
        const msg = "This browser cannot access microphones. Use a current version of Chrome, Edge, or Firefox.";
        setVoiceState("error");
        voiceStateRef.current = "error";
        setVoiceInputState("error");
        voiceInputStateRef.current = "error";
        setErrorMessage(msg);
        updateDiagnostics({ lastError: msg });
        micStartInProgressRef.current = false;
        return;
      }

      setVoiceState("connecting");
      voiceStateRef.current = "connecting";
      setVoiceInputState("connecting");
      voiceInputStateRef.current = "connecting";

      try {
        // startListening connects the transport (if not already) AND starts mic.
        await inworldSession.startListening();

        if (generation !== sessionGenerationRef.current) {
          inworldSession.stopListening();
          inworldSession.disconnect();
          micStartInProgressRef.current = false;
          return;
        }

        inworldConnectedRef.current = true;
        setVoiceTransportConnected(true);
        activeRef.current = true;
        micActiveRef.current = true;
        setVoiceMode("live");
        setVoiceState("listening");
        voiceStateRef.current = "listening";
        setVoiceInputState("listening");
        voiceInputStateRef.current = "listening";
        updateDiagnostics({ transportConnected: true, micActive: true, voicePhase: "listening" });

        await enumerateDevices();
      } catch (inworldErr) {
        console.warn("[Voice] Inworld failed:", inworldErr);
        inworldConnectedRef.current = false;
        setVoiceTransportConnected(false);
        const msg = inworldErr instanceof Error ? inworldErr.message : "Voice connection failed.";
        setVoiceState("error");
        voiceStateRef.current = "error";
        setVoiceInputState("error");
        voiceInputStateRef.current = "error";
        setErrorMessage(msg);
        updateDiagnostics({ lastError: msg, voicePhase: "error" });
        cleanup();
      } finally {
        micStartInProgressRef.current = false;
      }
    },
    [cleanup, enumerateDevices, inworldSession, logMicStart, setTiming, updateDiagnostics],
  );

  // ---------------------------------------------------------------------------
  // startVoice — backward-compat wrapper around requestMicrophoneStart.
  // ---------------------------------------------------------------------------

  const startVoice = useCallback(async () => {
    await requestMicrophoneStart({
      source: "composer_mic_click",
      trustedUserGesture: true,
    });
  }, [requestMicrophoneStart]);

  // ---------------------------------------------------------------------------
  // stopVoice
  // ---------------------------------------------------------------------------

  const stopVoice = useCallback(() => {
    console.debug("[Voice] stopVoice");
    const wasSpeaking = voiceOutputStateRef.current === "speaking";
    if (inworldConnectedRef.current) {
      inworldSession.stopListening();
      if (!wasSpeaking) {
        inworldSession.disconnect();
        inworldConnectedRef.current = false;
        setVoiceTransportConnected(false);
      }
    }
    activeRef.current = false;
    micActiveRef.current = false;
    micStartInProgressRef.current = false;
    sessionGenerationRef.current += 1;
    setVoiceInputState("idle");
    voiceInputStateRef.current = "idle";
    if (wasSpeaking) {
      setVoiceState("assistant_speaking");
      voiceStateRef.current = "assistant_speaking";
    } else {
      setVoiceState("idle");
      voiceStateRef.current = "idle";
      setVoiceOutputState("idle");
      voiceOutputStateRef.current = "idle";
    }
    cleanup();
    setTranscript("");
    setMicLevel(0);
    setVoiceMode(null);
    submittedTranscriptRef.current = "";
    updateDiagnostics({ micActive: false, transportConnected: inworldConnectedRef.current });
  }, [cleanup, inworldSession, updateDiagnostics]);

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
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // stopSpeaking
  // ---------------------------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (inworldConnectedRef.current) {
      inworldSession.interrupt();
    }
    setVoiceOutputState("idle");
    voiceOutputStateRef.current = "idle";
    if (voiceStateRef.current === "assistant_speaking") {
      setVoiceState("idle");
      voiceStateRef.current = "idle";
    }
  }, [inworldSession]);

  // ---------------------------------------------------------------------------
  // speakText — TTS via Inworld (inworld-tts-2 with configured voice).
  // Falls back to browser speechSynthesis if Inworld is not connected.
  // Does NOT activate the microphone.
  // ---------------------------------------------------------------------------

  const speakText = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      if (!ttsEnabledRef.current) return;

      const sanitized = sanitizeSpeech(text);
      if (!sanitized) return;

      setVoiceOutputState("speaking");
      voiceOutputStateRef.current = "speaking";
      setVoiceState("assistant_speaking");
      voiceStateRef.current = "assistant_speaking";
      setErrorMessage(null);
      updateDiagnostics({ voicePhase: "assistant_speaking", outputState: "speaking" });

      // Cancel any currently playing TTS
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const finishSpeaking = () => {
        setVoiceOutputState("idle");
        voiceOutputStateRef.current = "idle";
        if (voiceStateRef.current === "assistant_speaking") {
          if (handsFreeEnabledRef.current && activeRef.current) {
            setVoiceState("listening");
            voiceStateRef.current = "listening";
            setVoiceInputState("listening");
            voiceInputStateRef.current = "listening";
          } else {
            setVoiceState("idle");
            voiceStateRef.current = "idle";
          }
        }
        updateDiagnostics({ voicePhase: voiceStateRef.current, outputState: "idle" });
      };

      // Primary: Inworld TTS (uses configured INWORLD_LITT_VOICE / INWORLD_SPARK_VOICE)
      if (inworldConnectedRef.current) {
        try {
          await inworldSession.speakText(sanitized);
          // Inworld TTS playback completion is handled by the
          // onResponseComplete callback → finishSpeaking logic above.
          // But also set a safety timeout in case the event is missed.
          return;
        } catch (err) {
          console.warn("[Voice] Inworld TTS failed, falling back to browser TTS:", err);
        }
      }

      // Fallback: browser SpeechSynthesis
      if (typeof window === "undefined" || !window.speechSynthesis) {
        console.warn("[Voice] speechSynthesis not available");
        finishSpeaking();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(sanitized);
      const agentId = useVoiceStore.getState().activeAgent;
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const preferred = agentId === "spark"
          ? voices.find((v) => /female|zira|aria|jenny|samantha/i.test(v.name) && v.lang.startsWith("en"))
          : voices.find((v) => /male|david|mark|alex|daniel|fred/i.test(v.name) && v.lang.startsWith("en"));
        utterance.voice = preferred ?? voices.find((v) => v.lang === "en-US") ?? voices[0];
      }
      utterance.lang = "en-US";
      utterance.rate = agentId === "spark" ? 1.05 : 0.95;
      utterance.pitch = agentId === "spark" ? 1.1 : 0.9;

      utterance.onend = finishSpeaking;
      utterance.onerror = (e) => {
        console.warn("[Voice] speechSynthesis error:", e.error);
        finishSpeaking();
      };

      window.speechSynthesis.speak(utterance);
    },
    [inworldSession, updateDiagnostics],
  );

  // ---------------------------------------------------------------------------
  // interrupt
  // ---------------------------------------------------------------------------

  const interrupt = useCallback(() => {
    console.debug("[Voice] interrupt");
    stopSpeaking();
  }, [stopSpeaking]);

  // ---------------------------------------------------------------------------
  // selectDevice
  // ---------------------------------------------------------------------------

  const selectDevice = useCallback(
    (deviceId: string) => {
      try { localStorage.setItem(DEVICE_STORAGE_KEY, deviceId); } catch {}
      setSelectedDeviceId(deviceId);
      if (activeRef.current) {
        stopVoice();
        setTimeout(() => startVoice(), 300);
      }
    },
    [stopVoice, startVoice],
  );

  const setOnTurn = useCallback((handler: (text: string) => void) => {
    onTurnRef.current = handler;
  }, []);

  // ---------------------------------------------------------------------------
  // toggleTts / toggleHandsFree
  // ---------------------------------------------------------------------------

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0"); } catch {}
      ttsEnabledRef.current = next;
      return next;
    });
  }, []);

  const toggleHandsFree = useCallback(() => {
    setHandsFreeEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(HANDS_FREE_PREF_KEY, next ? "1" : "0"); } catch {}
      handsFreeEnabledRef.current = next;
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Hands-free resume — auto-resume listening after TTS finishes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!handsFreeEnabled) return;
    if (voiceOutputState !== "idle") return;
    if (!voiceTransportConnected) return;
    if (micActiveRef.current) return;
    if (micStartInProgressRef.current) return;

    const timer = window.setTimeout(() => {
      if (!handsFreeEnabledRef.current) return;
      if (micActiveRef.current) return;
      if (micStartInProgressRef.current) return;
      void requestMicrophoneStart({
        source: "hands_free_resume",
        trustedUserGesture: false,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [handsFreeEnabled, voiceOutputState, voiceTransportConnected, requestMicrophoneStart]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      activeRef.current = false;
      micActiveRef.current = false;
      micStartInProgressRef.current = false;
      if (inworldConnectedRef.current) {
        inworldSession.disconnect();
        inworldConnectedRef.current = false;
      }
      cleanup();
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
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
      voiceOutputState,
      voiceInputState,
      voiceTransportConnected,
      transcript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      voiceMode,
      timing: voiceStore.timing,
      latencies,
      ttsEnabled,
      handsFreeEnabled,
      diagnostics,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
      toggleTts,
      toggleHandsFree,
    }),
    [
      voiceState,
      voiceOutputState,
      voiceInputState,
      voiceTransportConnected,
      transcript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      voiceMode,
      voiceStore.timing,
      latencies,
      ttsEnabled,
      handsFreeEnabled,
      diagnostics,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
      toggleTts,
      toggleHandsFree,
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
