"use client";

/**
 * VoiceSessionContext — persistent Inworld voice session.
 *
 * ARCHITECTURE (v2 — ghost transcription fix):
 * - Uses useInworldSession for STT (WebSocket → voice-server proxy → Inworld)
 * - Uses Inworld TTS (inworld-tts-2 with configured INWORLD_LITT_VOICE / INWORLD_SPARK_VOICE)
 *   when the transport is connected, falling back to browser speechSynthesis
 * - PUSH-TO-TALK ONLY: tap to start recording, tap again to stop.
 *   Hands-free/continuous mode is REMOVED to prevent ghost transcription.
 * - Client-side VAD gates when audio is sent to Inworld (see voice-vad.ts)
 * - Transcript validation gate rejects filler/noise/empty/duplicate transcripts
 *   (see transcript-validation.ts)
 * - Echo isolation: mic is PAUSED during TTS playback and resumed after cooldown
 * - Default UX: stop recording → transcript appears as editable draft → user presses Send.
 *   Auto-send is an opt-in toggle (autoSendEnabled, default false).
 * - State machine: idle → requesting_permission → connecting → listening →
 *   processing → transcript_ready → sending → assistant_speaking → idle
 * - Only explicit "End Voice" / unmount / fatal error destroys the session
 *
 * Provider hierarchy (mounted in StudioOS.tsx):
 *   <VoiceSessionProvider>  ← this file
 *     <StudioShell>         ← tool switching happens here, voice persists
 *
 * @see src/features/voice/hooks/useInworldSession.ts
 * @see src/features/voice/lib/voice-vad.ts
 * @see src/features/voice/lib/transcript-validation.ts
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
import { useInworldSession, type TranscriptMetadata } from "@/features/voice/hooks/useInworldSession";
import { validateTranscript, type RejectionReason, type TranscriptValidationResult } from "@/features/voice/lib/transcript-validation";
import { VOICE_GATE_CONFIG } from "@/features/voice/lib/voice-gate-config";

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
  | "transcript_ready"
  | "sending"
  | "assistant_speaking"
  | "muted"
  | "permission_denied"
  | "unsupported"
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
  /** Current VAD state (client-side voice activity detection). */
  vadState: string;
  /** Last speech duration detected by VAD (ms). */
  lastSpeechDurationMs: number;
  /** Last transcript rejection reason (or "accepted"). */
  lastRejectionReason: RejectionReason | "accepted" | null;
  /** Last rejection explanation. */
  lastRejectionExplanation: string | null;
  /** Active MediaStream track count. */
  activeStreamCount: number;
  /** Current session generation (increments on each startListening). */
  sessionGeneration: number;
}

export interface VoiceSessionCtx {
  voiceState: VoiceState;
  voiceOutputState: VoiceOutputState;
  voiceInputState: VoiceInputState;
  voiceTransportConnected: boolean;
  /** Live interim transcript (updates as user speaks). */
  transcript: string;
  /** Finalized transcript pending user review (editable draft). */
  pendingTranscript: string | null;
  micLevel: number;
  errorMessage: string | null;
  isMuted: boolean;
  selectedDeviceId: string | null;
  availableDevices: MediaDeviceInfo[];
  voiceMode: "live" | "recording" | null;
  timing: VoiceTimingMetrics;
  latencies: ReturnType<typeof computeLatencies>;
  ttsEnabled: boolean;
  /** Auto-send finalized transcript (default: false — show editable draft). */
  autoSendEnabled: boolean;
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
  toggleAutoSend: () => void;
  /** Submit the pending transcript (explicit Send button). */
  submitTranscript: () => void;
  /** Cancel the current recording / clear pending transcript. */
  cancelRecording: () => void;
  /** Clear the pending transcript without sending. */
  clearPendingTranscript: () => void;
  /** Edit the pending transcript. */
  setPendingTranscript: (text: string) => void;
  /** Set the callback that receives finalized transcripts directly into the composer. */
  setOnTranscriptComplete: (handler: ((text: string) => void) | null) => void;
  /** Recording elapsed time in seconds (updates every second while recording). */
  recordingSeconds: number;
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
  vadState: "idle",
  lastSpeechDurationMs: 0,
  lastRejectionReason: null,
  lastRejectionExplanation: null,
  activeStreamCount: 0,
  sessionGeneration: 0,
};

const defaultCtx: VoiceSessionCtx = {
  voiceState: "idle",
  voiceOutputState: "idle",
  voiceInputState: "idle",
  voiceTransportConnected: false,
  transcript: "",
  pendingTranscript: null,
  micLevel: 0,
  errorMessage: null,
  isMuted: false,
  selectedDeviceId: null,
  availableDevices: [],
  voiceMode: null,
  timing: createInitialTimingMetrics(),
  latencies: computeLatencies(createInitialTimingMetrics()),
  ttsEnabled: true,
  autoSendEnabled: false,
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
  toggleAutoSend: noop,
  submitTranscript: noop,
  cancelRecording: noop,
  clearPendingTranscript: noop,
  setPendingTranscript: noop,
  setOnTranscriptComplete: noop as unknown as (handler: ((text: string) => void) | null) => void,
  recordingSeconds: 0,
};

export const VoiceSessionContext = createContext<VoiceSessionCtx>(defaultCtx);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEVICE_STORAGE_KEY = "litt:voice:deviceId";
const TTS_PREF_KEY = "litt:voice:ttsEnabled";
const AUTO_SEND_PREF_KEY = "litt:voice:autoSendEnabled";

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
  const [autoSendEnabled, setAutoSendEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return VOICE_GATE_CONFIG.ptt.autoSendDefault;
    return localStorage.getItem(AUTO_SEND_PREF_KEY) === "1";
  });
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>(defaultDiagnostics);
  const [pendingTranscript, setPendingTranscriptState] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
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
  const ttsEnabledRef = useRef(ttsEnabled);
  const autoSendEnabledRef = useRef(autoSendEnabled);
  const turnNumberRef = useRef(0);
  const pendingTranscriptRef = useRef<string | null>(null);
  const lastValidationResultRef = useRef<TranscriptValidationResult | null>(null);
  /** Ref to inworldSession.resumeMic — set after inworldSession is created.
   * Used by inworldOnResponseCompleteRef which is defined before inworldSession. */
  const resumeMicRef = useRef<() => void>(() => {});
  /** Callback that writes finalized transcripts directly into the composer. */
  const onTranscriptCompleteRef = useRef<((text: string) => void) | null>(null);
  /** Recording timer interval. */
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep pref refs in sync
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);
  useEffect(() => { autoSendEnabledRef.current = autoSendEnabled; }, [autoSendEnabled]);
  useEffect(() => { pendingTranscriptRef.current = pendingTranscript; }, [pendingTranscript]);

  // Update diagnostics helper — shallow-compares the patch to avoid
  // infinite setState loops when the effect deps trigger but values
  // haven't actually changed.
  const updateDiagnostics = useCallback((patch: Partial<VoiceDiagnostics>) => {
    setDiagnostics((prev) => {
      let changed = false;
      for (const key in patch) {
        if (prev[key as keyof VoiceDiagnostics] !== patch[key as keyof VoiceDiagnostics]) {
          changed = true;
          break;
        }
      }
      if (!changed) return prev;
      return { ...prev, ...patch };
    });
  }, []);

  // --- Inworld session (primary voice provider) ---
  const inworldOnTranscriptRef = useRef<(text: string, final: boolean, metadata?: TranscriptMetadata) => void>(() => {});
  const inworldOnAgentTextRef = useRef<(delta: string) => void>(() => {});
  const inworldOnErrorRef = useRef<(msg: string) => void>(() => {});
  const inworldOnResponseCompleteRef = useRef<() => void>(() => {});

  useEffect(() => {
    inworldOnTranscriptRef.current = (text: string, final: boolean, metadata?: TranscriptMetadata) => {
      if (final) {
        const trimmed = text.trim();
        console.debug("[Voice Pipeline] transcript received", { final, text: trimmed.slice(0, 80), metadata });

        // Stale callback check: ignore transcripts from previous sessions
        if (metadata?.sessionGeneration !== undefined && metadata.sessionGeneration !== sessionGenerationRef.current) {
          console.debug("[Voice Pipeline] ignoring stale transcript", {
            transcriptGen: metadata.sessionGeneration,
            currentGen: sessionGenerationRef.current,
          });
          return;
        }

        if (!trimmed || !activeRef.current) return;

        // ── Transcript validation gate ──
        // Reject filler, noise, empty, duplicate, during-TTS transcripts
        const validation = validateTranscript(trimmed, {
          previousTranscript: submittedTranscriptRef.current || null,
          ttsPlaying: voiceOutputStateRef.current === "speaking",
          speechDurationMs: metadata?.speechDurationMs,
        });
        lastValidationResultRef.current = validation;

        updateDiagnostics({
          lastTranscript: trimmed.slice(0, 60),
          lastRejectionReason: validation.reason,
          lastRejectionExplanation: validation.explanation,
          lastSpeechDurationMs: metadata?.speechDurationMs ?? 0,
        });

        if (!validation.accepted) {
          console.debug("[Voice Pipeline] transcript rejected", validation);
          // Don't send — write into composer if it's not empty/filler
          if (validation.reason !== "empty" && validation.reason !== "filler_only" && validation.reason !== "no_speech_detected") {
            if (onTranscriptCompleteRef.current) {
              onTranscriptCompleteRef.current(trimmed);
              setVoiceState("idle");
              voiceStateRef.current = "idle";
            } else {
              setPendingTranscriptState(trimmed);
              setVoiceState("transcript_ready");
              voiceStateRef.current = "transcript_ready";
            }
          }
          return;
        }

        // Transcript accepted
        const acceptedText = validation.transcript;
        submittedTranscriptRef.current = acceptedText;
        setTranscript(acceptedText);
        turnNumberRef.current += 1;
        updateDiagnostics({
          turnNumber: turnNumberRef.current,
          lastTranscript: acceptedText.slice(0, 60),
          lastRejectionReason: "accepted",
          lastRejectionExplanation: "Transcript accepted.",
        });
        setTiming({ recordingEndedAt: Date.now(), transcriptionCompletedAt: Date.now(), aiResponseStartedAt: Date.now() });

        if (autoSendEnabledRef.current) {
          // Auto-send: send immediately
          console.debug("[Voice Pipeline] auto-send enabled, sending transcript", { transcript: acceptedText.slice(0, 80) });
          setVoiceState("sending");
          voiceStateRef.current = "sending";
          onTurnRef.current(acceptedText);
          setTiming({ aiResponseCompletedAt: Date.now() });
        } else if (onTranscriptCompleteRef.current) {
          // Unified composer: write transcript directly into the composer textarea
          console.debug("[Voice Pipeline] writing transcript into composer", { transcript: acceptedText.slice(0, 80) });
          onTranscriptCompleteRef.current(acceptedText);
          setVoiceState("idle");
          voiceStateRef.current = "idle";
        } else {
          // Fallback: show as editable draft (legacy pending transcript panel)
          console.debug("[Voice Pipeline] showing editable draft (legacy)", { transcript: acceptedText.slice(0, 80) });
          setPendingTranscriptState(acceptedText);
          setVoiceState("transcript_ready");
          voiceStateRef.current = "transcript_ready";
        }
      } else {
        // Interim transcript — show visually but NEVER send
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
      // A failed microphone/transport start must not claim that TTS or audio
      // playback failed. Keep the independent output path usable.
      if (
        voiceOutputStateRef.current === "connecting" ||
        voiceOutputStateRef.current === "speaking"
      ) {
        setVoiceOutputState("error");
        voiceOutputStateRef.current = "error";
      }
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
      // No hands-free resume — push-to-talk only.
      // Resume mic after cooldown (echo isolation)
      if (VOICE_GATE_CONFIG.echo.pauseMicDuringTts) {
        resumeMicRef.current();
      }
      if (voiceStateRef.current === "assistant_speaking" || voiceStateRef.current === "processing") {
        setVoiceState("idle");
        voiceStateRef.current = "idle";
      }
    };
  });

  const inworldSession = useInworldSession({
    onTranscript: (text: string, final: boolean, metadata?: TranscriptMetadata) => inworldOnTranscriptRef.current(text, final, metadata),
    onAgentText: (delta: string) => inworldOnAgentTextRef.current(delta),
    onError: (msg: string) => inworldOnErrorRef.current(msg),
    onResponseComplete: () => inworldOnResponseCompleteRef.current(),
  });

  // Keep resumeMicRef in sync so inworldOnResponseCompleteRef can call it
  // without accessing inworldSession before it's declared.
  useEffect(() => {
    resumeMicRef.current = inworldSession.resumeMic;
  }, [inworldSession.resumeMic]);

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

  // Keep a ref to inworldSession so the diagnostics effect doesn't depend on
  // its identity (useInworldSession returns a new object every render, which
  // would cause an infinite setState loop if used as a useEffect dependency).
  const inworldSessionRef = useRef(inworldSession);
  useEffect(() => { inworldSessionRef.current = inworldSession; });

  // Sync diagnostics from state
  useEffect(() => {
    updateDiagnostics({
      transportConnected: inworldConnectedRef.current,
      micActive: micActiveRef.current,
      voicePhase: voiceState,
      inputState: voiceInputState,
      outputState: voiceOutputState,
      vadState: inworldSessionRef.current.getVadState(),
      sessionGeneration: sessionGenerationRef.current,
      activeStreamCount: streamRef.current?.getTracks().length ?? 0,
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
      // Hands-free mode removed — only explicit user gestures start the mic
      if (!isExplicitGesture) {
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
      // Stop the mic and commit the audio buffer so Inworld can finish STT.
      // Do NOT disconnect the WebSocket — the STT response
      // (conversation.item.input_audio_transcription.completed) arrives
      // AFTER input_audio_buffer.commit, and disconnecting here kills it.
      inworldSession.stopListening();
    }
    // Do NOT set activeRef.current = false here — the transcript handler
    // checks activeRef and would silently drop the STT result.
    micActiveRef.current = false;
    micStartInProgressRef.current = false;
    setVoiceInputState("idle");
    voiceInputStateRef.current = "idle";
    if (wasSpeaking) {
      setVoiceState("assistant_speaking");
      voiceStateRef.current = "assistant_speaking";
    } else {
      // Transition to "processing" — waiting for STT to complete.
      // The transcript handler will either auto-send (if autoSendEnabled)
      // or show an editable draft (transcript_ready state).
      setVoiceState("processing");
      voiceStateRef.current = "processing";
    }
    setMicLevel(0);
    updateDiagnostics({ micActive: false, transportConnected: inworldConnectedRef.current });

    // Safety timeout: if STT doesn't produce a transcript within 8s,
    // transition back to idle so the user isn't stuck in "processing".
    const gen = sessionGenerationRef.current;
    window.setTimeout(() => {
      if (
        gen === sessionGenerationRef.current &&
        voiceStateRef.current === "processing"
      ) {
        console.debug("[Voice] STT timeout — returning to idle");
        setVoiceState("idle");
        voiceStateRef.current = "idle";
      }
    }, 8_000);
  }, [inworldSession, updateDiagnostics]);

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

      // ── Echo isolation: pause mic before TTS ──
      if (VOICE_GATE_CONFIG.echo.pauseMicDuringTts) {
        inworldSession.pauseMic();
      }

      setVoiceOutputState("speaking");
      voiceOutputStateRef.current = "speaking";
      setVoiceState("assistant_speaking");
      voiceStateRef.current = "assistant_speaking";
      updateDiagnostics({
        provider: "inworld",
        voicePhase: "assistant_speaking",
        outputState: "speaking",
      });

      // Cancel any currently playing TTS
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const finishSpeaking = () => {
        setVoiceOutputState("idle");
        voiceOutputStateRef.current = "idle";
        // Resume mic after cooldown (echo isolation)
        if (VOICE_GATE_CONFIG.echo.pauseMicDuringTts) {
          inworldSession.resumeMic();
        }
        if (voiceStateRef.current === "assistant_speaking") {
          // No hands-free resume — push-to-talk only
          setVoiceState("idle");
          voiceStateRef.current = "idle";
        }
        updateDiagnostics({ voicePhase: voiceStateRef.current, outputState: "idle" });
      };

      // Primary: Inworld TTS (uses configured INWORLD_LITT_VOICE / INWORLD_SPARK_VOICE)
      // Always try Inworld first — inworldSession.speakText auto-connects the
      // transport if needed. This lets "Speak" work without first starting voice.
      try {
        console.debug("[Voice Pipeline] TTS request started", { textLength: sanitized.length, preview: sanitized.slice(0, 60) });
        await inworldSession.speakText(sanitized);
        // Mark transport as connected since speakText auto-connects
        if (!inworldConnectedRef.current) {
          inworldConnectedRef.current = true;
          setVoiceTransportConnected(true);
          updateDiagnostics({ transportConnected: true });
        }
        // Inworld TTS playback completion is handled by the
        // onResponseComplete callback → finishSpeaking logic above.
        // But also set a safety timeout in case the event is missed.
        return;
      } catch (err) {
        console.warn("[Voice Pipeline] TTS failed (Inworld), falling back to browser TTS:", err);
        // Mark transport as disconnected if it failed
        if (inworldConnectedRef.current) {
          inworldConnectedRef.current = false;
          setVoiceTransportConnected(false);
          updateDiagnostics({ transportConnected: false });
        }
        updateDiagnostics({ provider: "browser", transportConnected: false });
      }

      // Fallback: browser SpeechSynthesis
      console.debug("[Voice Pipeline] browser TTS fallback started");
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

      utterance.onend = () => {
        console.debug("[Voice Pipeline] playback ended (browser TTS)");
        finishSpeaking();
      };
      utterance.onerror = (e) => {
        console.warn("[Voice Pipeline] playback failed (browser TTS):", e.error);
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

  const setOnTranscriptComplete = useCallback((handler: ((text: string) => void) | null) => {
    onTranscriptCompleteRef.current = handler;
  }, []);

  // ---------------------------------------------------------------------------
  // Recording timer — tracks elapsed seconds while listening/processing
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (voiceState === "listening" || voiceState === "user_speaking") {
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [voiceState]);

  // ---------------------------------------------------------------------------
  // toggleTts / toggleAutoSend
  // ---------------------------------------------------------------------------

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0"); } catch {}
      ttsEnabledRef.current = next;
      return next;
    });
  }, []);

  const toggleAutoSend = useCallback(() => {
    setAutoSendEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(AUTO_SEND_PREF_KEY, next ? "1" : "0"); } catch {}
      autoSendEnabledRef.current = next;
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // submitTranscript — explicit Send button for the editable draft
  // ---------------------------------------------------------------------------

  const submitTranscript = useCallback(() => {
    const draft = pendingTranscriptRef.current;
    if (!draft || !draft.trim()) return;
    const trimmed = draft.trim();
    submittedTranscriptRef.current = trimmed;
    setPendingTranscriptState(null);
    setVoiceState("sending");
    voiceStateRef.current = "sending";
    console.debug("[Voice Pipeline] user submitted transcript", { transcript: trimmed.slice(0, 80) });
    onTurnRef.current(trimmed);
    setTiming({ aiResponseCompletedAt: Date.now() });
  }, [setTiming]);

  // ---------------------------------------------------------------------------
  // cancelRecording — stop recording and clear pending transcript
  // ---------------------------------------------------------------------------

  const cancelRecording = useCallback(() => {
    console.debug("[Voice] cancelRecording");
    if (inworldConnectedRef.current) {
      inworldSession.stopListening();
    }
    micActiveRef.current = false;
    micStartInProgressRef.current = false;
    activeRef.current = false;
    setVoiceInputState("idle");
    voiceInputStateRef.current = "idle";
    setVoiceState("idle");
    voiceStateRef.current = "idle";
    setPendingTranscriptState(null);
    setTranscript("");
    setMicLevel(0);
    updateDiagnostics({ micActive: false });
  }, [inworldSession, updateDiagnostics]);

  // ---------------------------------------------------------------------------
  // clearPendingTranscript — clear the draft without sending
  // ---------------------------------------------------------------------------

  const clearPendingTranscript = useCallback(() => {
    setPendingTranscriptState(null);
    if (voiceStateRef.current === "transcript_ready") {
      setVoiceState("idle");
      voiceStateRef.current = "idle";
    }
  }, []);

  const setPendingTranscript = useCallback((text: string) => {
    setPendingTranscriptState(text);
  }, []);

  // ---------------------------------------------------------------------------
  // Hands-free resume — REMOVED. Push-to-talk only.
  // ---------------------------------------------------------------------------

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
  // Stop mic on tab hidden / page hide (prevents ghost capture in background)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && micActiveRef.current) {
        console.debug("[Voice] tab hidden — stopping mic");
        stopVoice();
      }
    };
    const handlePageHide = () => {
      if (micActiveRef.current) {
        console.debug("[Voice] page hide — stopping mic");
        stopVoice();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [stopVoice]);

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
      pendingTranscript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      voiceMode,
      timing: voiceStore.timing,
      latencies,
      ttsEnabled,
      autoSendEnabled,
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
      toggleAutoSend,
      submitTranscript,
      cancelRecording,
      clearPendingTranscript,
      setPendingTranscript,
      setOnTranscriptComplete,
      recordingSeconds,
    }),
    [
      voiceState, voiceOutputState, voiceInputState, voiceTransportConnected,
      transcript, pendingTranscript, micLevel, errorMessage, isMuted,
      selectedDeviceId, availableDevices, voiceMode, voiceStore.timing,
      latencies, ttsEnabled, autoSendEnabled, diagnostics,
      startVoice, stopVoice, toggleMute, interrupt, speakText, stopSpeaking,
      selectDevice, setOnTurn, toggleTts, toggleAutoSend,
      submitTranscript, cancelRecording, clearPendingTranscript, setPendingTranscript,
      setOnTranscriptComplete, recordingSeconds,
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
