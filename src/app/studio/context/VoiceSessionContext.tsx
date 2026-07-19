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
import { cleanTextForSpeech } from "@/lib/tts-clean";
import { sanitizeProviderError } from "@/lib/provider-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "cooldown"
  | "error";

export type VoiceActivity =
  | { type: "idle" }
  | { type: "requesting_permission" }
  | { type: "connecting" }
  | { type: "listening" }
  | { type: "speech_detected"; durationMs: number }
  | { type: "transcribing" }
  | { type: "sending" }
  | { type: "thinking" }
  | { type: "using_tool"; tool: string }
  | { type: "reading_files"; files: [number, number] }
  | { type: "writing_files"; files: [number, number] }
  | { type: "running_command"; command: string }
  | { type: "testing"; tests: [number, number] }
  | { type: "generating_response" }
  | { type: "speaking" }
  | { type: "paused" }
  | { type: "complete" }
  | { type: "cooldown"; retryAfter?: number }
  | { type: "error"; message: string };

export type VoiceTimingStage =
  | "speech_end"
  | "transcription_complete"
  | "AI_first_token"
  | "AI_complete"
  | "TTS_request"
  | "TTS_first_audio"
  | "playback_started";
export type VoiceTimings = Partial<Record<VoiceTimingStage, number>>;

const ACTIVITY_TO_VOICE_STATE: Record<
  VoiceActivity["type"],
  VoiceState | undefined
> = {
  idle: "idle",
  requesting_permission: "listening",
  connecting: "listening",
  listening: "listening",
  speech_detected: "listening",
  transcribing: "transcribing",
  sending: "thinking",
  thinking: "thinking",
  using_tool: "thinking",
  reading_files: "thinking",
  writing_files: "thinking",
  running_command: "thinking",
  testing: "thinking",
  generating_response: "thinking",
  speaking: "speaking",
  paused: "idle",
  complete: "idle",
  cooldown: "cooldown",
  error: "error",
};

export interface VoiceSessionCtx {
  voiceState: VoiceState;
  state: "idle" | "loading" | "speaking" | "error";
  transcript: string;
  interimTranscript: string;
  micLevel: number;
  errorMessage: string | null;
  cooldownRemaining: number;
  isMuted: boolean;
  selectedDeviceId: string | null;
  availableDevices: MediaDeviceInfo[];
  listeningDurationMs: number;
  activity: VoiceActivity;
  timings: VoiceTimings;
  // Actions
  startVoice: () => void;
  stopVoice: () => void;
  toggleMute: () => void;
  interrupt: () => void;
  speakText: (text: string) => void;
  stopSpeaking: () => void;
  selectDevice: (deviceId: string) => void;
  setOnTurn: (handler: (text: string) => void) => void;
  setActivity: (activity: VoiceActivity) => void;
  markTiming: (stage: VoiceTimingStage) => void;
}

// ---------------------------------------------------------------------------
// Context default
// ---------------------------------------------------------------------------

const noop = () => {};

const defaultCtx: VoiceSessionCtx = {
  voiceState: "idle",
  state: "idle",
  transcript: "",
  interimTranscript: "",
  micLevel: 0,
  errorMessage: null,
  cooldownRemaining: 0,
  isMuted: false,
  selectedDeviceId: null,
  availableDevices: [],
  listeningDurationMs: 0,
  activity: { type: "idle" },
  timings: {},
  startVoice: noop,
  stopVoice: noop,
  toggleMute: noop,
  interrupt: noop,
  speakText: noop,
  stopSpeaking: noop,
  selectDevice: noop,
  setOnTurn: noop,
  setActivity: noop,
  markTiming: noop,
};

export const VoiceSessionContext = createContext<VoiceSessionCtx>(defaultCtx);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEVICE_STORAGE_KEY = "litt:voice:deviceId";
const SILENCE_THRESHOLD = 0.02;
const SPEECH_START_THRESHOLD = 0.035;
const SILENCE_TIMEOUT_MS = 1200;
const MAX_RECORDING_MS = 30_000;
const CHUNK_INTERVAL_MS = 250;
const MIN_RECORDING_MS = 500;
const MIN_BLOB_SIZE = 8000;
const MIN_TRANSCRIBE_INTERVAL_MS = 2000;

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile|CriOS/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024)
  );
}

function getSupportedMimeType(): string | undefined {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  if (typeof window === "undefined" || !window.MediaRecorder) return undefined;
  return types.find((t) => MediaRecorder.isTypeSupported(t));
}

function getUserMediaErrorMessage(err: DOMException): string {
  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone permission denied. Allow microphone access in your browser/site settings.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone found. Connect a microphone and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "Microphone is in use by another application.";
    case "AbortError":
      return "Microphone request was cancelled.";
    case "SecurityError":
      return "Microphone access blocked by security policy.";
    default:
      return err.message || "Microphone error.";
  }
}

export function VoiceSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // --- State ---
  const [voiceState, setVoiceStateRaw] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
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
  const [listeningDurationMs, setListeningDurationMs] = useState(0);
  const [activity, setActivityState] = useState<VoiceActivity>({
    type: "idle",
  });
  const [timings, setTimings] = useState<VoiceTimings>({});
  const markTiming = useCallback((stage: VoiceTimingStage) => {
    setTimings((current) => ({ ...current, [stage]: performance.now() }));
  }, []);

  const state: "idle" | "loading" | "speaking" | "error" = useMemo(() => {
    if (voiceState === "speaking") return "speaking";
    if (voiceState === "error" || voiceState === "cooldown") return "error";
    if (voiceState === "idle") return "idle";
    return "loading";
  }, [voiceState]);

  // --- Refs ---
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsCancelledRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const listeningStartMsRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("idle");
  const onTurnRef = useRef<(text: string) => void>(noop);
  const prevMicLevelRef = useRef(0);
  const speechDetectedRef = useRef(false);
  const activityRef = useRef<VoiceActivity>({ type: "idle" });
  const recorderMimeTypeRef = useRef<string>("audio/webm");
  const lastTranscribeMsRef = useRef<number>(0);
  const pendingListenRestartRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startVoiceRef = useRef<() => Promise<void>>(async () => {});

  // Keep mirrors in sync
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  const setVoiceState = useCallback(
    (next: VoiceState) => {
      voiceStateRef.current = next;
      setVoiceStateRaw(next);
    },
    [setVoiceStateRaw],
  );

  const setActivity = useCallback(
    (next: VoiceActivity) => {
      activityRef.current = next;
      setActivityState(next);
      const mapped = ACTIVITY_TO_VOICE_STATE[next.type];
      if (mapped) setVoiceState(mapped);
    },
    [setActivityState, setVoiceState],
  );

  // ---------------------------------------------------------------------------
  // cleanup
  // ---------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    console.debug("[LiTT Voice] cleanup");

    if (pendingListenRestartRef.current) {
      clearTimeout(pendingListenRestartRef.current);
      pendingListenRestartRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;

    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    recordedChunksRef.current = [];

    ttsCancelledRef.current = true;
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxRecordingTimerRef.current !== null) {
      clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }

    speechDetectedRef.current = false;
    listeningStartMsRef.current = null;
    setListeningDurationMs(0);
    setMicLevel(0);
    prevMicLevelRef.current = 0;
  }, []);

  // ---------------------------------------------------------------------------
  // Cooldown
  // ---------------------------------------------------------------------------

  const enterCooldown = useCallback(
    (seconds: number) => {
      console.debug("[LiTT Voice] cooldown entered:", seconds);
      cleanup();
      setTranscript("");
      setInterimTranscript("");
      setErrorMessage("Voice limit reached");
      setCooldownRemaining(seconds);
      setActivity({ type: "cooldown", retryAfter: seconds });
      activeRef.current = false;
    },
    [cleanup, setActivity],
  );

  const finishCooldown = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    setActivity({ type: "idle" });
    setCooldownRemaining(0);
    setErrorMessage(null);
  }, [setActivity]);

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

  useEffect(() => {
    const run = () => void enumerateDevices();
    run();
    navigator.mediaDevices.addEventListener("devicechange", run);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", run);
  }, [enumerateDevices]);

  // ---------------------------------------------------------------------------
  // Transcription helpers
  // ---------------------------------------------------------------------------

  const finalizeRecording = useCallback(() => {
    markTiming("speech_end");
    if (mediaRecorderRef.current?.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, [markTiming]);

  const sendForTranscription = useCallback(
    async (chunks: Blob[]) => {
      const mimeType = recorderMimeTypeRef.current || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });

      const recordingDuration = listeningStartMsRef.current
        ? Date.now() - listeningStartMsRef.current
        : 0;

      if (blob.size < MIN_BLOB_SIZE || recordingDuration < MIN_RECORDING_MS) {
        setActivity({ type: "listening" });
        setInterimTranscript("");
        speechDetectedRef.current = false;
        recordedChunksRef.current = [];
        // Re-arm with a fresh stream/recorder; a stopped MediaRecorder cannot be restarted.
        voiceStateRef.current = "idle";
        void startVoiceRef.current();
        return;
      }

      setActivity({ type: "transcribing" });

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let base64 = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          base64 += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + chunkSize)) as unknown as number[],
          );
        }
        base64 = btoa(base64);

        // Throttle to avoid Gemini per-minute rate limits.
        const now = Date.now();
        const elapsed = now - lastTranscribeMsRef.current;
        if (elapsed < MIN_TRANSCRIBE_INTERVAL_MS) {
          const wait = MIN_TRANSCRIBE_INTERVAL_MS - elapsed;
          await new Promise((r) => setTimeout(r, wait));
        }
        lastTranscribeMsRef.current = Date.now();

        const res = await fetch("/api/media/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBytes: base64, mimeType }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const raw =
            typeof err.error === "string"
              ? err.error
              : `Transcription API error ${res.status}`;

          if (
            res.status === 429 ||
            /rate limit|too many requests|429|resource_exhausted/i.test(raw)
          ) {
            const { retryAfter } = sanitizeProviderError(new Error(raw));
            const seconds =
              typeof err.retryAfter === "number" ? err.retryAfter : retryAfter || 60;
            enterCooldown(seconds);
            return;
          }

          throw new Error(raw);
        }

        const data = (await res.json()) as { text?: string };
        const text = data.text?.trim();
        markTiming("transcription_complete");

        if (!text) {
          setActivity({ type: "listening" });
          setInterimTranscript("");
          setErrorMessage(
            "No speech detected. Try speaking closer to the mic.",
          );
          speechDetectedRef.current = false;
          return;
        }

        // Hallucination guard
        const durationSec = recordingDuration / 1000;
        const wordCount = text.split(/\s+/).length;
        const maxExpectedWords = Math.max(5, durationSec * 5);
        if (wordCount > maxExpectedWords) {
          console.warn(
            "[LiTT Voice] transcript length suspicious for duration — likely hallucination, discarding",
            { wordCount, durationSec, text: text.slice(0, 100) },
          );
          setActivity({ type: "listening" });
          setInterimTranscript("");
          speechDetectedRef.current = false;
          recordedChunksRef.current = [];
          // Re-arm with a fresh stream/recorder.
          voiceStateRef.current = "idle";
          void startVoiceRef.current();
          return;
        }

        setTranscript(text);
        setInterimTranscript("");
        setActivity({ type: "sending" });

        // Hand off to chat
        onTurnRef.current(text);

        // If no TTS/speakText is triggered within 2s, restart listening.
        if (activeRef.current) {
          if (pendingListenRestartRef.current) {
            clearTimeout(pendingListenRestartRef.current);
          }
          pendingListenRestartRef.current = setTimeout(() => {
            pendingListenRestartRef.current = null;
            if (
              activeRef.current &&
              voiceStateRef.current === "thinking"
            ) {
              setActivity({ type: "listening" });
              speechDetectedRef.current = false;
              recordedChunksRef.current = [];
              try {
                mediaRecorderRef.current?.start(CHUNK_INTERVAL_MS);
              } catch {
                // ignore
              }
            }
          }, 2000);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Transcription failed";
        console.error("[LiTT Voice] transcription error:", msg);
        setActivity({ type: "error", message: msg });
        setErrorMessage(msg);
      }
    },
    [enterCooldown, markTiming, setActivity],
  );

  // ---------------------------------------------------------------------------
  // Mic level + duration + speech detection loop
  // ---------------------------------------------------------------------------

  const startMicLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const mobile = isMobileDevice();
    const speechStart = mobile ? SPEECH_START_THRESHOLD * 1.8 : SPEECH_START_THRESHOLD;
    const silence = mobile ? SILENCE_THRESHOLD * 2.5 : SILENCE_THRESHOLD;
    let speechHitCount = 0;
    const SPEECH_HITS_REQUIRED = mobile ? 4 : 2;

    const tick = () => {
      if (!activeRef.current || voiceStateRef.current !== "listening") {
        rafRef.current = null;
        return;
      }

      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128 - 1;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 3);

      if (Math.abs(level - prevMicLevelRef.current) > 0.02) {
        prevMicLevelRef.current = level;
        setMicLevel(level);
      }

      if (listeningStartMsRef.current) {
        setListeningDurationMs(Date.now() - listeningStartMsRef.current);
      }

      // Speech detection — require sustained signal to avoid false triggers
      if (!speechDetectedRef.current && level > speechStart) {
        speechHitCount++;
        if (speechHitCount >= SPEECH_HITS_REQUIRED) {
          speechDetectedRef.current = true;
          setActivity({ type: "speech_detected", durationMs: 0 });
        }
      } else if (!speechDetectedRef.current) {
        speechHitCount = 0;
      }

      if (speechDetectedRef.current) {
        if (level > silence) {
          if (silenceTimerRef.current !== null) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (silenceTimerRef.current === null) {
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = null;
            finalizeRecording();
          }, SILENCE_TIMEOUT_MS);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [setActivity, finalizeRecording]);

  // ---------------------------------------------------------------------------
  // startVoice
  // ---------------------------------------------------------------------------

  const startVoice = useCallback(async () => {
    const current = voiceStateRef.current;
    if (current !== "idle" && current !== "error") {
      console.debug("[LiTT Voice] startVoice ignored — state:", current);
      return;
    }

    console.debug("[LiTT Voice] session start");
    setActivity({ type: "requesting_permission" });
    setErrorMessage(null);
    setTranscript("");
    setInterimTranscript("");

    cleanup();

    if (typeof window === "undefined" || !window.MediaRecorder) {
      setActivity({ type: "error", message: "MediaRecorder not supported" });
      setErrorMessage("MediaRecorder not supported in this browser.");
      return;
    }

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      setActivity({ type: "error", message: "No supported audio MIME type" });
      setErrorMessage("No supported audio format found in this browser.");
      return;
    }

    const baseAudio: MediaTrackConstraints = {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
    };
    let constraints: MediaStreamConstraints = { audio: baseAudio };
    if (selectedDeviceId) {
      constraints = {
        audio: { ...baseAudio, deviceId: { ideal: selectedDeviceId } },
      };
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: unknown) {
      const domErr = err as DOMException;
      // If the stored device is gone or over-constrained, fall back to default mic.
      if (
        selectedDeviceId &&
        (domErr.name === "NotFoundError" ||
          domErr.name === "OverconstrainedError" ||
          domErr.name === "DevicesNotFoundError")
      ) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: baseAudio });
        } catch (fallbackErr: unknown) {
          const e = fallbackErr as DOMException;
          const msg = getUserMediaErrorMessage(e);
          console.error("[LiTT Voice] getUserMedia fallback error:", e.name, msg);
          setActivity({ type: "error", message: msg });
          setErrorMessage(msg);
          return;
        }
      } else {
        const e = err as DOMException;
        const msg = getUserMediaErrorMessage(e);
        console.error("[LiTT Voice] getUserMedia error:", e.name, msg);
        setActivity({ type: "error", message: msg });
        setErrorMessage(msg);
        return;
      }
    }

    console.debug("[LiTT Voice] stream id:", stream.id);
    streamRef.current = stream;
    activeRef.current = true;

    setActivity({ type: "connecting" });

    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (err) {
      console.warn("[LiTT Voice] AudioContext setup failed:", err);
    }

    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorderMimeTypeRef.current = recorder.mimeType || mimeType;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        if (chunks.length > 0) {
          void sendForTranscription(chunks);
        }
      };

      recorder.onerror = (ev) => {
        console.error("[LiTT Voice] MediaRecorder error:", ev);
        setActivity({ type: "error", message: "Recording error" });
        setErrorMessage("Recording error. Please try again.");
      };

      recorder.start(CHUNK_INTERVAL_MS);
      listeningStartMsRef.current = Date.now();
      setListeningDurationMs(0);
      setActivity({ type: "listening" });
      startMicLevelLoop();

      // Max recording safety net
      maxRecordingTimerRef.current = setTimeout(() => {
        if (voiceStateRef.current === "listening") {
          finalizeRecording();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.error("[LiTT Voice] MediaRecorder start failed:", err);
      setActivity({ type: "error", message: "Could not start recorder" });
      setErrorMessage("Could not start audio recorder.");
      cleanup();
    }
  }, [
    cleanup,
    selectedDeviceId,
    startMicLevelLoop,
    sendForTranscription,
    setActivity,
    finalizeRecording,
  ]);

  useEffect(() => {
    startVoiceRef.current = startVoice;
  }, [startVoice]);

  // ---------------------------------------------------------------------------
  // stopVoice
  // ---------------------------------------------------------------------------

  const stopVoice = useCallback(() => {
    console.debug("[LiTT Voice] stopVoice");
    activeRef.current = false;
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    setCooldownRemaining(0);
    setActivity({ type: "idle" });
    cleanup();
    setTranscript("");
    setInterimTranscript("");
    setErrorMessage(null);
  }, [cleanup, setActivity]);

  // ---------------------------------------------------------------------------
  // toggleMute
  // ---------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      const tracks = streamRef.current?.getAudioTracks() ?? [];
      tracks.forEach((t) => {
        t.enabled = !next;
      });
      console.debug("[LiTT Voice] mute toggled:", next);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // stopSpeaking
  // ---------------------------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    ttsCancelledRef.current = true;
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // speakText
  // ---------------------------------------------------------------------------

  const speakText = useCallback(
    (rawText: string) => {
      const text = cleanTextForSpeech(rawText);
      if (!text.trim()) return;

      stopSpeaking();
      ttsCancelledRef.current = false;

      if (pendingListenRestartRef.current) {
        clearTimeout(pendingListenRestartRef.current);
        pendingListenRestartRef.current = null;
      }

      if (mediaRecorderRef.current?.state === "recording") {
        try {
          mediaRecorderRef.current.pause();
        } catch {
          // ignore
        }
      }

      setActivity({ type: "speaking" });
      markTiming("TTS_request");

      const onSpeechEnd = () => {
        if (ttsCancelledRef.current) return;
        const recorder = mediaRecorderRef.current;
        if (recorder?.state === "paused") {
          try {
            recorder.resume();
          } catch {
            // ignore
          }
        } else if (recorder?.state === "inactive" && activeRef.current) {
          // Restart with a fresh stream/recorder rather than reusing the old one.
          recordedChunksRef.current = [];
          voiceStateRef.current = "idle";
          void startVoiceRef.current();
          return;
        }
        if (activeRef.current) {
          setActivity({ type: "listening" });
          speechDetectedRef.current = false;
          startMicLevelLoop();
        } else {
          setActivity({ type: "idle" });
        }
      };

      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "aoede" }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const raw =
              typeof data.error === "string"
                ? data.error
                : `TTS ${res.status}`;

            if (
              res.status === 429 ||
              /rate limit|too many requests|429|resource_exhausted/i.test(raw)
            ) {
              const { retryAfter } = sanitizeProviderError(new Error(raw));
              const seconds =
                typeof data.retryAfter === "number"
                  ? data.retryAfter
                  : retryAfter || 60;
              enterCooldown(seconds);
              return;
            }

            throw new Error(raw);
          }

          const blob = await res.blob();
          markTiming("TTS_first_audio");
          const src = URL.createObjectURL(blob);
          const audio = new Audio(src);
          currentAudioRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(src);
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            onSpeechEnd();
          };

          audio.onerror = () => {
            URL.revokeObjectURL(src);
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            if (ttsCancelledRef.current) return;
            console.warn(
              "[LiTT Voice] HTMLAudio error — falling back to speechSynthesis",
            );
            fallbackSynth(text, onSpeechEnd);
          };

          try {
            await audio.play();
            markTiming("playback_started");
          } catch (err) {
            URL.revokeObjectURL(src);
            if (ttsCancelledRef.current) return;
            console.warn("[LiTT Voice] audio.play() blocked:", err);
            fallbackSynth(text, onSpeechEnd);
          }
        })
        .catch((err) => {
          if (ttsCancelledRef.current) return;
          console.warn(
            "[LiTT Voice] /api/tts failed:",
            err,
            "— falling back to speechSynthesis",
          );
          fallbackSynth(text, onSpeechEnd);
        });
    },
    [stopSpeaking, startMicLevelLoop, setActivity, enterCooldown, markTiming],
  );

  // ---------------------------------------------------------------------------
  // interrupt
  // ---------------------------------------------------------------------------

  const interrupt = useCallback(() => {
    console.debug("[LiTT Voice] interrupt");
    stopSpeaking();
    if (mediaRecorderRef.current?.state === "paused") {
      try {
        mediaRecorderRef.current.resume();
      } catch {
        // ignore
      }
    }
    if (activeRef.current) {
      setActivity({ type: "listening" });
      startMicLevelLoop();
    }
  }, [stopSpeaking, startMicLevelLoop, setActivity]);

  // ---------------------------------------------------------------------------
  // selectDevice
  // ---------------------------------------------------------------------------

  const selectDevice = useCallback(
    (deviceId: string) => {
      localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
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
  // Cooldown countdown
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (voiceState !== "cooldown" || cooldownRemaining <= 0) {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      return;
    }

    cooldownTimerRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) {
            clearInterval(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
          }
          finishCooldown();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [voiceState, cooldownRemaining, finishCooldown]);

  // ---------------------------------------------------------------------------
  // Page lifecycle recovery
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume().catch(() => {});
        }
      }
    };
    const onPageShow = () => {
      if (activeRef.current && voiceStateRef.current === "listening") {
        startMicLevelLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [startMicLevelLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const ctx = useMemo<VoiceSessionCtx>(
    () => ({
      voiceState,
      state,
      transcript,
      interimTranscript,
      micLevel,
      errorMessage,
      cooldownRemaining,
      isMuted,
      selectedDeviceId,
      availableDevices,
      listeningDurationMs,
      activity,
      timings,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
      setActivity,
      markTiming,
    }),
    [
      voiceState,
      state,
      transcript,
      interimTranscript,
      micLevel,
      errorMessage,
      cooldownRemaining,
      isMuted,
      selectedDeviceId,
      availableDevices,
      listeningDurationMs,
      activity,
      timings,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
      setActivity,
      markTiming,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fallbackSynth(text: string, onEnd: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd();
    return;
  }
  const utt = new SpeechSynthesisUtterance(text);
  utt.onend = onEnd;
  utt.onerror = onEnd;
  window.speechSynthesis.speak(utt);
}
