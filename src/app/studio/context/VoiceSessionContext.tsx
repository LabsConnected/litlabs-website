"use client";

/**
 * VoiceSessionContext — persistent OpenAI Realtime WebRTC voice session.
 *
 * ARCHITECTURE (Handbook v11):
 * - One OpenAIRealtimeProvider instance, stored in a ref (survives re-renders)
 * - Session persists across multiple conversation turns
 * - Mic track stays alive between turns (muted/unmuted, NOT stopped)
 * - State machine: ready → listening → finalizing → responding → speaking → ready
 * - Only explicit "End Voice" / unmount / fatal error destroys the session
 * - Inworld is DISABLED — no second conversation engine
 *
 * Provider hierarchy (mounted in StudioOS.tsx):
 *   <VoiceSessionProvider>  ← this file
 *     <StudioShell>         ← tool switching happens here, voice persists
 *
 * @see src/lib/litt/voice/openai-realtime.ts
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
import { OpenAIRealtimeProvider } from "@/lib/litt/voice/openai-realtime";
import { AGENT_META } from "../stores/useStudioAgentStore";

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
  // Diagnostics — for the Voice Diagnostics drawer
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

export interface VoiceDiagnostics {
  sessionId: string | null;
  provider: string;
  tokenCreatedAt: number | null;
  connectionState: RTCPeerConnectionState | null;
  iceConnectionState: RTCIceConnectionState | null;
  dataChannelState: RTCDataChannelState | null;
  micPermission: PermissionState | null;
  trackReadyState: MediaStreamTrackState | null;
  trackEnabled: boolean | null;
  voicePhase: VoiceState;
  lastTranscriptEvent: string | null;
  lastAssistantEvent: string | null;
  lastPlaybackEvent: string | null;
  lastError: string | null;
  turnNumber: number;
}

// ---------------------------------------------------------------------------
// Context default
// ---------------------------------------------------------------------------

const noop = () => {};

const defaultDiagnostics: VoiceDiagnostics = {
  sessionId: null,
  provider: "openai-realtime",
  tokenCreatedAt: null,
  connectionState: null,
  iceConnectionState: null,
  dataChannelState: null,
  micPermission: null,
  trackReadyState: null,
  trackEnabled: null,
  voicePhase: "idle",
  lastTranscriptEvent: null,
  lastAssistantEvent: null,
  lastPlaybackEvent: null,
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
  // The OpenAI Realtime provider — ONE instance, stored in a ref, survives re-renders.
  // This is the persistent session that stays alive across multiple turns.
  const providerRef = useRef<OpenAIRealtimeProvider | null>(null);
  const providerUnsubscribersRef = useRef<Array<() => void>>([]);
  const activeRef = useRef(false); // true while a voice session is live
  const voiceStateRef = useRef<VoiceState>("idle");
  const voiceInputStateRef = useRef<VoiceInputState>("idle");
  const voiceOutputStateRef = useRef<VoiceOutputState>("idle");
  const onTurnRef = useRef<(text: string) => void>(noop);
  const submittedTranscriptRef = useRef("");
  const turnNumberRef = useRef(0);
  const micStartInProgressRef = useRef(false);
  const micActiveRef = useRef(false);
  const handsFreeEnabledRef = useRef(handsFreeEnabled);
  const ttsEnabledRef = useRef(ttsEnabled);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Keep pref refs in sync
  useEffect(() => { handsFreeEnabledRef.current = handsFreeEnabled; }, [handsFreeEnabled]);
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  // Keep voiceStateRef in sync
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { voiceInputStateRef.current = voiceInputState; }, [voiceInputState]);
  useEffect(() => { voiceOutputStateRef.current = voiceOutputState; }, [voiceOutputState]);

  // Update diagnostics helper
  const updateDiagnostics = useCallback((patch: Partial<VoiceDiagnostics>) => {
    setDiagnostics((prev) => ({ ...prev, ...patch }));
  }, []);

  // ---------------------------------------------------------------------------
  // Get or create the persistent OpenAI Realtime provider
  // ---------------------------------------------------------------------------

  const getProvider = useCallback((): OpenAIRealtimeProvider => {
    if (!providerRef.current) {
      providerRef.current = new OpenAIRealtimeProvider();
    }
    return providerRef.current;
  }, []);

  // ---------------------------------------------------------------------------
  // Wire up provider event handlers — called ONCE when provider is created
  // ---------------------------------------------------------------------------

  const wireProviderEvents = useCallback((provider: OpenAIRealtimeProvider) => {
    // Clear any previous subscribers
    providerUnsubscribersRef.current.forEach((unsub) => unsub());
    providerUnsubscribersRef.current = [];

    // User transcript (partial)
    providerUnsubscribersRef.current.push(
      provider.onUserTranscriptDelta(({ text, isFinal }) => {
        if (!isFinal) {
          setTranscript((prev) => prev + text);
          updateDiagnostics({ lastTranscriptEvent: `delta: ${text.slice(0, 40)}` });
        }
      }),
    );

    // User transcript (final) → canonical pipeline
    providerUnsubscribersRef.current.push(
      provider.onUserTranscriptComplete(({ text }) => {
        const trimmed = text.trim();
        if (trimmed && trimmed !== submittedTranscriptRef.current && activeRef.current) {
          submittedTranscriptRef.current = trimmed;
          setTranscript(trimmed);
          turnNumberRef.current += 1;
          updateDiagnostics({
            turnNumber: turnNumberRef.current,
            lastTranscriptEvent: `final: ${trimmed.slice(0, 40)}`,
          });
          setTiming({
            recordingEndedAt: Date.now(),
            transcriptionCompletedAt: Date.now(),
            aiResponseStartedAt: Date.now(),
          });
          // Transition to processing — waiting for assistant response
          setVoiceState("processing");
          voiceStateRef.current = "processing";
          // Canonical pipeline: final transcript → onTurn → onSend →
          // /api/gemini/chat → response stored → speakText
          onTurnRef.current(trimmed);
          setTiming({ aiResponseCompletedAt: Date.now() });
        }
      }),
    );

    // Transport state changes
    providerUnsubscribersRef.current.push(
      provider.onTransportChange((state) => {
        if (state === "connected") {
          setVoiceTransportConnected(true);
          updateDiagnostics({ connectionState: "connected" });
        } else if (state === "disconnected") {
          setVoiceTransportConnected(false);
          updateDiagnostics({ connectionState: "disconnected" });
          // Only go to error if we didn't explicitly disconnect
          if (activeRef.current) {
            setVoiceState("error");
            voiceStateRef.current = "error";
            setErrorMessage("Voice connection lost. Click the mic to reconnect.");
          }
        }
      }),
    );

    // Mic state changes
    providerUnsubscribersRef.current.push(
      provider.onMicChange((state) => {
        updateDiagnostics({ trackEnabled: state === "on" });
        if (state === "on") {
          micActiveRef.current = true;
        } else if (state === "off") {
          micActiveRef.current = false;
        }
      }),
    );

    // Playback events — critical for the speaking → ready transition
    providerUnsubscribersRef.current.push(
      provider.onPlaybackStarted((messageId) => {
        updateDiagnostics({ lastPlaybackEvent: `started: ${messageId.slice(0, 8)}` });
      }),
    );

    providerUnsubscribersRef.current.push(
      provider.onPlaybackCompleted(() => {
        updateDiagnostics({ lastPlaybackEvent: "completed" });
        // CRITICAL: speaking → ready (NOT speaking → idle/disconnected)
        setVoiceOutputState("idle");
        voiceOutputStateRef.current = "idle";
        if (voiceStateRef.current === "assistant_speaking") {
          // Return to listening if hands-free, otherwise ready (idle but transport alive)
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
      }),
    );

    // Errors
    providerUnsubscribersRef.current.push(
      provider.onError((error) => {
        console.warn("[Voice] Provider error:", error.message);
        updateDiagnostics({ lastError: error.message });
        setErrorMessage(error.message);
        if (!error.retryable) {
          setVoiceState("error");
          voiceStateRef.current = "error";
        }
      }),
    );
  }, [setTiming, updateDiagnostics]);

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
  // startVoice — connects the persistent WebRTC session + starts mic
  // ---------------------------------------------------------------------------

  const startVoice = useCallback(async () => {
    if (micActiveRef.current) {
      console.debug("[Voice] startVoice ignored — mic already active");
      return;
    }
    if (micStartInProgressRef.current) {
      console.debug("[Voice] startVoice ignored — start in progress");
      return;
    }

    micStartInProgressRef.current = true;
    setErrorMessage(null);
    setTranscript("");
    setIsMuted(false);
    submittedTranscriptRef.current = "";
    setTiming({ recordingStartedAt: Date.now() });

    const provider = getProvider();
    wireProviderEvents(provider);

    setVoiceState("connecting");
    voiceStateRef.current = "connecting";
    setVoiceInputState("connecting");
    voiceInputStateRef.current = "connecting";

    try {
      const activeAgent = useVoiceStore.getState().activeAgent;
      const agentMeta = AGENT_META[activeAgent] ?? AGENT_META.litt;
      const voice = activeAgent === "spark" ? "shimmer" : "alloy";

      // Connect if not already connected (persistent session — reuse if alive)
      const runtimeState = provider.getRuntimeState();
      if (runtimeState.transport !== "connected") {
        updateDiagnostics({ tokenCreatedAt: Date.now() });
        await provider.connect({
          agentId: activeAgent,
          instructions: agentMeta.systemPrompt,
          voice,
        });
      }

      // Start the microphone (enables the existing track, doesn't create a new one)
      await provider.startMicrophone();

      activeRef.current = true;
      setVoiceMode("live");
      setVoiceState("listening");
      voiceStateRef.current = "listening";
      setVoiceInputState("listening");
      voiceInputStateRef.current = "listening";
      updateDiagnostics({ voicePhase: "listening" });

      await enumerateDevices();
    } catch (err) {
      console.warn("[Voice] Connection failed:", err);
      const msg = err instanceof Error ? err.message : "Voice connection failed.";
      setVoiceState("error");
      voiceStateRef.current = "error";
      setVoiceInputState("error");
      voiceInputStateRef.current = "error";
      setErrorMessage(msg);
      updateDiagnostics({ lastError: msg, voicePhase: "error" });
    } finally {
      micStartInProgressRef.current = false;
    }
  }, [getProvider, wireProviderEvents, enumerateDevices, setTiming, updateDiagnostics]);

  // ---------------------------------------------------------------------------
  // stopVoice — explicit "End Voice" — the ONLY path that destroys the session
  // ---------------------------------------------------------------------------

  const stopVoice = useCallback(async () => {
    console.debug("[Voice] stopVoice — destroying session");
    activeRef.current = false;
    micActiveRef.current = false;
    micStartInProgressRef.current = false;

    // Stop TTS audio
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }

    // Disconnect the provider (closes WebRTC peer connection, data channel, mic)
    if (providerRef.current) {
      await providerRef.current.disconnect();
    }

    setVoiceTransportConnected(false);
    setVoiceState("idle");
    voiceStateRef.current = "idle";
    setVoiceInputState("idle");
    voiceInputStateRef.current = "idle";
    setVoiceOutputState("idle");
    voiceOutputStateRef.current = "idle";
    setVoiceMode(null);
    setTranscript("");
    setMicLevel(0);
    submittedTranscriptRef.current = "";
    updateDiagnostics({
      voicePhase: "idle",
      connectionState: "closed",
      trackReadyState: null,
      trackEnabled: null,
    });
  }, [updateDiagnostics]);

  // ---------------------------------------------------------------------------
  // toggleMute — mute/unmute mic WITHOUT destroying the track
  // ---------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (providerRef.current) {
        void providerRef.current.setMuted(next);
      }
      if (next) {
        setVoiceState("muted");
        voiceStateRef.current = "muted";
      } else {
        // Unmute → return to listening if transport is alive
        if (voiceTransportConnected) {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
        }
      }
      return next;
    });
  }, [voiceTransportConnected]);

  // ---------------------------------------------------------------------------
  // browserTtsFallback — Browser SpeechSynthesis fallback (declared before
  // speakText so it's in scope for the useCallback closure)
  // ---------------------------------------------------------------------------

  const browserTtsFallback = useCallback(
    (text: string, agentId: string, onEnd: () => void): void => {
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
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // speakText — TTS via OpenAI TTS API with browser fallback
  // Auto-speak fires on every reply when TTS is enabled.
  // ---------------------------------------------------------------------------

  const speakText = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      if (!ttsEnabledRef.current) return;

      const sanitized = sanitizeSpeech(text);
      if (!sanitized) return;

      // Set speaking state
      setVoiceOutputState("speaking");
      voiceOutputStateRef.current = "speaking";
      setVoiceState("assistant_speaking");
      voiceStateRef.current = "assistant_speaking";
      setErrorMessage(null);
      updateDiagnostics({ voicePhase: "assistant_speaking", lastAssistantEvent: `speak: ${sanitized.slice(0, 40)}` });

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
        // CRITICAL: speaking → ready (NOT speaking → idle/disconnected)
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
        updateDiagnostics({ voicePhase: voiceStateRef.current, lastPlaybackEvent: "completed" });
      };

      // Try OpenAI TTS first (high quality, natural voice)
      const activeAgent = useVoiceStore.getState().activeAgent;
      const openaiVoice = activeAgent === "spark" ? "nova" : "onyx";

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
              console.warn("[Voice] OpenAI TTS audio error, falling back");
              ttsAudioRef.current = null;
              browserTtsFallback(sanitized, activeAgent, finishSpeaking);
            };
            await audio.play();
            return;
          }
        }
        browserTtsFallback(sanitized, activeAgent, finishSpeaking);
      } catch (err) {
        console.warn("[Voice] OpenAI TTS error:", err);
        browserTtsFallback(sanitized, activeAgent, finishSpeaking);
      }
    },
    [updateDiagnostics, browserTtsFallback],
  );

  // ---------------------------------------------------------------------------
  // stopSpeaking — cancel TTS playback
  // ---------------------------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
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
  // interrupt — cancel TTS + cancel any pending Realtime response
  // ---------------------------------------------------------------------------

  const interrupt = useCallback(() => {
    console.debug("[Voice] interrupt");
    stopSpeaking();
    if (providerRef.current) {
      void providerRef.current.interrupt();
    }
  }, [stopSpeaking]);

  // ---------------------------------------------------------------------------
  // selectDevice
  // ---------------------------------------------------------------------------

  const selectDevice = useCallback(
    (deviceId: string) => {
      localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
      setSelectedDeviceId(deviceId);
      // If currently active, restart with new device
      if (activeRef.current) {
        void stopVoice();
        setTimeout(() => void startVoice(), 300);
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
      // Re-enable mic on the existing session (no new connection needed)
      if (providerRef.current) {
        void providerRef.current.startMicrophone().then(() => {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          setVoiceInputState("listening");
          voiceInputStateRef.current = "listening";
        });
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [handsFreeEnabled, voiceOutputState, voiceTransportConnected]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount ONLY — this is the only place that destroys the session
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      console.debug("[Voice] Provider unmounting — destroying session");
      activeRef.current = false;
      micActiveRef.current = false;
      micStartInProgressRef.current = false;
      // Unsubscribe all event handlers
      providerUnsubscribersRef.current.forEach((unsub) => unsub());
      providerUnsubscribersRef.current = [];
      // Disconnect the provider
      if (providerRef.current) {
        void providerRef.current.disconnect();
        providerRef.current = null;
      }
      // Cancel TTS
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
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
