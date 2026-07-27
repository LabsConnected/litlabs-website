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

/**
 * Output side of voice — TTS playback. Independent of the microphone.
 * LiTT can speak while the microphone stays completely off.
 */
export type VoiceOutputState = "idle" | "connecting" | "speaking" | "error";

/**
 * Input side of voice — microphone capture. Starts ONLY from an explicit
 * user gesture (mic button click) or enabled hands-free mode.
 */
export type VoiceInputState =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "listening"
  | "error";

/**
 * Source label for every microphone-start attempt. Used by the guarded
 * `requestMicrophoneStart` entry point for instrumentation and validation.
 */
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

export interface VoiceSessionCtx {
  /** Derived display state — backward compat for existing consumers. */
  voiceState: VoiceState;
  /** Independent output (TTS) state. */
  voiceOutputState: VoiceOutputState;
  /** Independent input (microphone) state. */
  voiceInputState: VoiceInputState;
  /** True when the voice WebSocket transport is connected (TTS-ready). */
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
  /** Whether LiTT speaks responses via TTS. Persisted. Default: true. */
  ttsEnabled: boolean;
  /** Whether listening auto-resumes after TTS. Persisted. Default: false. */
  handsFreeEnabled: boolean;
  // Actions
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
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [voiceMode, setVoiceMode] = useState<"live" | "recording" | null>(null);
  // Persisted user preferences only — never persist transient mic state.
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(TTS_PREF_KEY);
    return stored === null ? true : stored === "1";
  });
  const [handsFreeEnabled, setHandsFreeEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(HANDS_FREE_PREF_KEY) === "1";
  });
  const voiceStore = useVoiceStore();
  const setTiming = voiceStore.setTiming;

  // --- Refs ---
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeRef = useRef(false); // true while a session is live
  const voiceStateRef = useRef<VoiceState>("idle"); // mirror for RAF/async callbacks
  const voiceInputStateRef = useRef<VoiceInputState>("idle");
  const voiceOutputStateRef = useRef<VoiceOutputState>("idle");
  const onTurnRef = useRef<(text: string) => void>(noop);
  const submittedTranscriptRef = useRef("");
  const sessionGenerationRef = useRef(0);
  // Guards for the single microphone entry point — idempotent against
  // Strict Mode double-invoke and overlapping async starts.
  const micStartInProgressRef = useRef(false);
  const micActiveRef = useRef(false);
  const handsFreeEnabledRef = useRef(handsFreeEnabled);
  const ttsEnabledRef = useRef(ttsEnabled);

  // Keep pref refs in sync so async callbacks read the latest value.
  useEffect(() => { handsFreeEnabledRef.current = handsFreeEnabled; }, [handsFreeEnabled]);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  // --- Inworld session (primary voice provider) ---
  // Use refs for callbacks to avoid capturing mutable refs in hook closures
  const inworldOnTranscriptRef = useRef<(text: string, final: boolean) => void>(() => {});
  const inworldOnAgentTextRef = useRef<(delta: string) => void>(() => {});
  const inworldOnErrorRef = useRef<(msg: string) => void>(() => {});
  const inworldOnResponseCompleteRef = useRef<() => void>(() => {});

  // Intentionally no dependency array — the ref callbacks must always reflect
  // the latest closures (so `activeRef`, `submittedTranscriptRef`, `setTiming`,
  // `onTurnRef`, etc. are up-to-date). This is a documented React pattern.
  useEffect(() => {
    inworldOnTranscriptRef.current = (text: string, final: boolean) => {
      if (final) {
        const trimmed = text.trim();
        if (trimmed && trimmed !== submittedTranscriptRef.current && activeRef.current) {
          submittedTranscriptRef.current = trimmed;
          setTranscript(trimmed);
          setTiming({ recordingEndedAt: Date.now(), transcriptionCompletedAt: Date.now(), aiResponseStartedAt: Date.now() });
          activeRef.current = false;
          // Canonical pipeline: final transcript → onTurn → onSend →
          // /api/gemini/chat → response stored → speakText (browser TTS).
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
    };
    inworldOnResponseCompleteRef.current = () => {
      // Inworld's auto-response finished. In STT-only mode we ignore this —
      // TTS is handled by browser speechSynthesis which has its own onend.
      setVoiceOutputState("idle");
      voiceOutputStateRef.current = "idle";
      if (voiceStateRef.current === "assistant_speaking") {
        setVoiceState("idle");
        voiceStateRef.current = "idle";
      }
    };
  });

  const inworldSession = useInworldSession({
    onTranscript: (text: string, final: boolean) => inworldOnTranscriptRef.current(text, final),
    onAgentText: (delta: string) => inworldOnAgentTextRef.current(delta),
    onError: (msg: string) => inworldOnErrorRef.current(msg),
    onResponseComplete: () => inworldOnResponseCompleteRef.current(),
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

  useEffect(() => {
    voiceInputStateRef.current = voiceInputState;
  }, [voiceInputState]);

  useEffect(() => {
    voiceOutputStateRef.current = voiceOutputState;
  }, [voiceOutputState]);

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
  // requestMicrophoneStart — the SINGLE guarded entry point for mic activation
  // ---------------------------------------------------------------------------
  //
  // All microphone activation must go through this function. It validates the
  // source, logs an instrumentation event, and rejects any caller that is not
  // an explicit user gesture or an enabled hands-free resume.
  //
  // Allowed sources:
  //   - composer_mic_click      (trusted user gesture)
  //   - floating_voice_button   (trusted user gesture)
  //   - hands_free_resume       (only when handsFreeEnabled is true)
  //
  // All other sources are rejected and logged.

  const logMicStart = useCallback(
    (source: MicrophoneStartSource, accepted: boolean, reason?: string) => {
      const event = {
        event: "microphone_start_requested",
        source,
        accepted,
        reason: reason ?? null,
        eventTrusted:
          typeof Event !== "undefined" &&
          typeof window !== "undefined" &&
          typeof window.event !== "undefined" &&
          window.event instanceof Event &&
          (window.event as Event).isTrusted,
        userActivationActive:
          typeof navigator !== "undefined" &&
          "userActivation" in navigator &&
          (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true,
        currentState: voiceStateRef.current,
        inputState: voiceInputStateRef.current,
        outputState: voiceOutputStateRef.current,
        handsFreeEnabled: handsFreeEnabledRef.current,
        timestamp: new Date().toISOString(),
        // Stack is included for diagnosis only — stripped from production
        // telemetry by the logging layer if needed.
        stack: new Error().stack ?? null,
      };
      console.debug("[Voice]", event);
    },
    [],
  );

  const requestMicrophoneStart = useCallback(
    async (args: {
      source: MicrophoneStartSource;
      trustedUserGesture?: boolean;
    }): Promise<void> => {
      const { source, trustedUserGesture = false } = args;

      // Idempotent guards — prevent duplicate streams / Strict Mode double-invoke.
      if (micActiveRef.current) {
        logMicStart(source, false, "already_active");
        return;
      }
      if (micStartInProgressRef.current) {
        logMicStart(source, false, "start_in_progress");
        return;
      }

      // Source validation. Only explicit user gestures or enabled hands-free
      // resume may start the microphone.
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
        console.debug("[Voice] requestMicrophoneStart ignored — already active, state:", current);
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

      // Always clean up before starting
      activeRef.current = false;
      sessionGenerationRef.current += 1;
      const generation = sessionGenerationRef.current;
      cleanup();

      // Check microphone availability (without acquiring — Inworld acquires it)
      if (!navigator.mediaDevices?.getUserMedia) {
        const msg = "This browser cannot access microphones. Use a current version of Chrome, Edge, or Firefox.";
        setVoiceState("error");
        voiceStateRef.current = "error";
        setVoiceInputState("error");
        voiceInputStateRef.current = "error";
        setErrorMessage(msg);
        micStartInProgressRef.current = false;
        return;
      }

      setVoiceState("connecting");
      voiceStateRef.current = "connecting";
      setVoiceInputState("connecting");
      voiceInputStateRef.current = "connecting";

      try {
        console.debug("[Voice] starting Inworld session (mic)");
        // startListening connects the transport (if not already) AND starts mic.
        await inworldSession.startListening();

        // Invalidate if user stopped voice while connecting
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
        console.debug("[Voice] Inworld session connected (mic on)");

        // Enumerate devices after permission was granted by startMicCapture
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
        cleanup();
      } finally {
        micStartInProgressRef.current = false;
      }
    },
    [cleanup, enumerateDevices, inworldSession, logMicStart, setTiming],
  );

  // ---------------------------------------------------------------------------
  // startVoice — backward-compat wrapper around requestMicrophoneStart.
  // Called from the trusted mic-button click handler.
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
    // Stop the microphone side only. If LiTT is still speaking (TTS),
    // we keep the transport alive so playback can finish — only the mic
    // is being stopped. The previous implementation called disconnect()
    // unconditionally, which closed the WebSocket and the playback
    // AudioContext, cutting off TTS mid-sentence.
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
      // LiTT is still speaking — keep voiceState as assistant_speaking so
      // the UI reflects reality. Only the mic input is idle.
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
    // Cancel OpenAI TTS audio
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    // Cancel browser SpeechSynthesis
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setVoiceOutputState("idle");
    voiceOutputStateRef.current = "idle";
    if (voiceStateRef.current === "assistant_speaking") {
      setVoiceState("idle");
      voiceStateRef.current = "idle";
    }
  }, []);

  // ---------------------------------------------------------------------------
  // speakText — TTS via OpenAI TTS API (high quality) with browser
  // SpeechSynthesis fallback. Does NOT activate the microphone.
  // The spoken text EXACTLY matches the stored chat message.
  // ---------------------------------------------------------------------------

  // Track the current audio element so we can cancel it
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

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

      const agentId = useVoiceStore.getState().activeAgent;
      // OpenAI voice per agent: LiTT = onyx (deep male), Spark = nova (warm female)
      const openaiVoice = agentId === "spark" ? "nova" : "onyx";

      // Cancel any currently playing TTS
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.src = "";
        ttsAudioRef.current = null;
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const finishSpeaking = () => {
        setVoiceOutputState("idle");
        voiceOutputStateRef.current = "idle";
        if (voiceStateRef.current === "assistant_speaking") {
          setVoiceState("idle");
          voiceStateRef.current = "idle";
        }
      };

      // Try OpenAI TTS first (high quality, natural voice)
      try {
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sanitized, voice: openaiVoice }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.audioUrl) {
            const audio = new Audio(data.audioUrl);
            ttsAudioRef.current = audio;
            audio.onended = () => {
              ttsAudioRef.current = null;
              finishSpeaking();
            };
            audio.onerror = () => {
              console.warn("[Voice] OpenAI TTS audio error, falling back to browser TTS");
              ttsAudioRef.current = null;
              browserTtsFallback(sanitized, agentId, finishSpeaking);
            };
            await audio.play();
            return;
          }
        }
        // If OpenAI TTS fails, fall back to browser SpeechSynthesis
        console.warn("[Voice] OpenAI TTS API failed, using browser fallback");
        browserTtsFallback(sanitized, agentId, finishSpeaking);
      } catch (err) {
        console.warn("[Voice] OpenAI TTS error:", err);
        browserTtsFallback(sanitized, agentId, finishSpeaking);
      }
    },
    [],
  );

  // Browser SpeechSynthesis fallback (used when OpenAI TTS is unavailable)
  function browserTtsFallback(
    text: string,
    agentId: string,
    onEnd: () => void,
  ): void {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.warn("[Voice] speechSynthesis not available");
      onEnd();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
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
    utterance.onend = onEnd;
    utterance.onerror = (e) => {
      console.warn("[Voice] speechSynthesis error:", e.error);
      onEnd();
    };
    window.speechSynthesis.speak(utterance);
  }

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
  // toggleTts / toggleHandsFree — persisted user preferences only.
  // Transient mic state is never persisted.
  // ---------------------------------------------------------------------------

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      ttsEnabledRef.current = next;
      return next;
    });
  }, []);

  const toggleHandsFree = useCallback(() => {
    setHandsFreeEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HANDS_FREE_PREF_KEY, next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      handsFreeEnabledRef.current = next;
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Hands-free resume — the ONLY path that auto-starts the mic without a
  // direct user gesture. Fires only when the user has explicitly enabled
  // hands-free mode AND TTS just finished AND the transport is connected.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!handsFreeEnabled) return;
    if (voiceOutputState !== "idle") return;
    if (!voiceTransportConnected) return;
    // Only resume when transitioning out of speaking — not on every idle tick.
    // The mic must not already be active.
    if (micActiveRef.current) return;
    if (micStartInProgressRef.current) return;

    // Wait a brief beat so stale audio drains, then start listening once.
    const timer = window.setTimeout(() => {
      // Re-verify the same session is still active and mic is still idle.
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
