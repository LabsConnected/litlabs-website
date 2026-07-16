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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceState =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "listening"
  | "speech_detected"
  | "transcribing"
  | "sending"
  | "thinking"
  | "using_tool"
  | "reading_files"
  | "writing_files"
  | "running_command"
  | "testing"
  | "generating_response"
  | "speaking"
  | "muted"
  | "paused"
  | "complete"
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
  | { type: "error"; message: string };

export interface VoiceSessionCtx {
  voiceState: VoiceState;
  state: "idle" | "loading" | "speaking" | "error";
  transcript: string;
  interimTranscript: string;
  micLevel: number;
  errorMessage: string | null;
  isMuted: boolean;
  selectedDeviceId: string | null;
  availableDevices: MediaDeviceInfo[];
  listeningDurationMs: number;
  activity: VoiceActivity;
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
  isMuted: false,
  selectedDeviceId: null,
  availableDevices: [],
  listeningDurationMs: 0,
  activity: { type: "idle" },
  startVoice: noop,
  stopVoice: noop,
  toggleMute: noop,
  interrupt: noop,
  speakText: noop,
  stopSpeaking: noop,
  selectDevice: noop,
  setOnTurn: noop,
  setActivity: noop,
};

export const VoiceSessionContext = createContext<VoiceSessionCtx>(defaultCtx);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEVICE_STORAGE_KEY = "litt:voice:deviceId";
const SILENCE_THRESHOLD = 0.02;
const SPEECH_START_THRESHOLD = 0.035;
const SILENCE_TIMEOUT_MS = 2500;
const MAX_RECORDING_MS = 30_000;
const CHUNK_INTERVAL_MS = 250;
const MIN_RECORDING_MS = 500; // don't transcribe clips shorter than this
const MIN_BLOB_SIZE = 8000; // don't transcribe blobs smaller than this

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile|CriOS/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024)
  );
}

function getSupportedMimeType(): string | undefined {
  // Order matters: prefer high-quality opus codecs, but include mobile-
  // friendly formats. iOS Safari supports audio/mp4 (AAC) but NOT webm.
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
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
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
  const [listeningDurationMs, setListeningDurationMs] = useState(0);
  const [activity, setActivityState] = useState<VoiceActivity>({
    type: "idle",
  });

  const state: "idle" | "loading" | "speaking" | "error" = useMemo(() => {
    if (voiceState === "speaking") return "speaking";
    if (voiceState === "error") return "error";
    if (
      voiceState === "idle" ||
      voiceState === "complete" ||
      voiceState === "paused" ||
      voiceState === "muted"
    )
      return "idle";
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

  // Keep mirrors in sync
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  const setActivity = useCallback((next: VoiceActivity) => {
    activityRef.current = next;
    setActivityState(next);
  }, []);

  // ---------------------------------------------------------------------------
  // cleanup
  // ---------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    console.debug("[LiTT Voice] cleanup");

    // Stop mic tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Close AudioContext
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;

    // Stop MediaRecorder
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

    // Stop TTS
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

    // Cancel RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Clear timers
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
    if (mediaRecorderRef.current?.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  const sendForTranscription = useCallback(
    async (chunks: Blob[]) => {
      // Use the actual mimeType the MediaRecorder used, NOT a fresh
      // getSupportedMimeType() call — on mobile the result can differ and
      // produce a mismatch that corrupts the audio sent to Gemini.
      const mimeType = recorderMimeTypeRef.current || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });

      // Check recording duration — don't transcribe clips shorter than
      // MIN_RECORDING_MS (likely just noise or a button mis-tap)
      const recordingDuration = listeningStartMsRef.current
        ? Date.now() - listeningStartMsRef.current
        : 0;

      if (blob.size < MIN_BLOB_SIZE || recordingDuration < MIN_RECORDING_MS) {
        // Too short — likely no speech, go back to listening
        setVoiceState("listening");
        voiceStateRef.current = "listening";
        setActivity({ type: "listening" });
        setInterimTranscript("");
        speechDetectedRef.current = false;
        recordedChunksRef.current = [];
        try {
          mediaRecorderRef.current?.start(CHUNK_INTERVAL_MS);
        } catch {
          // ignore
        }
        return;
      }

      setVoiceState("transcribing");
      voiceStateRef.current = "transcribing";
      setActivity({ type: "transcribing" });

      try {
        const arrayBuffer = await blob.arrayBuffer();
        // Efficient base64 encoding — chunked to avoid call-stack overflow
        // on mobile devices with larger audio buffers
        const bytes = new Uint8Array(arrayBuffer);
        let base64 = "";
        const chunkSize = 0x8000; // 32KB chunks
        for (let i = 0; i < bytes.length; i += chunkSize) {
          base64 += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + chunkSize)) as unknown as number[],
          );
        }
        base64 = btoa(base64);

        const res = await fetch("/api/media/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBytes: base64, mimeType }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const clean =
            typeof err.error === "string"
              ? err.error
              : `Transcription API error ${res.status}`;
          throw new Error(clean);
        }

        const data = (await res.json()) as { text?: string };
        const text = data.text?.trim();

        if (!text) {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          setActivity({ type: "listening" });
          setInterimTranscript("");
          setErrorMessage(
            "No speech detected. Try speaking closer to the mic.",
          );
          speechDetectedRef.current = false;
          return;
        }

        // Hallucination guard: if the transcript is suspiciously long
        // relative to the recording duration, it's likely Gemini
        // inventing text from noise. Normal speech is ~2.5 words/second.
        // Allow generous margin but reject extreme cases.
        const durationSec = recordingDuration / 1000;
        const wordCount = text.split(/\s+/).length;
        const maxExpectedWords = Math.max(5, durationSec * 5); // 5 wps = very fast
        if (wordCount > maxExpectedWords) {
          console.warn(
            "[LiTT Voice] transcript length suspicious for duration — likely hallucination, discarding",
            { wordCount, durationSec, text: text.slice(0, 100) },
          );
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          setActivity({ type: "listening" });
          setInterimTranscript("");
          speechDetectedRef.current = false;
          recordedChunksRef.current = [];
          try {
            mediaRecorderRef.current?.start(CHUNK_INTERVAL_MS);
          } catch {
            // ignore
          }
          return;
        }

        setTranscript(text);
        setInterimTranscript("");
        setVoiceState("sending");
        voiceStateRef.current = "sending";
        setActivity({ type: "sending" });

        // Hand off to chat
        onTurnRef.current(text);

        // After handing off, go back to listening if still active
        if (activeRef.current) {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          setActivity({ type: "listening" });
          speechDetectedRef.current = false;
          recordedChunksRef.current = [];
          try {
            mediaRecorderRef.current?.start(CHUNK_INTERVAL_MS);
          } catch {
            // ignore
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Transcription failed";
        console.error("[LiTT Voice] transcription error:", msg);
        setVoiceState("error");
        voiceStateRef.current = "error";
        setActivity({ type: "error", message: msg });
        setErrorMessage(msg);
      }
    },
    [setActivity],
  );

  // ---------------------------------------------------------------------------
  // Mic level + duration + speech detection loop
  // ---------------------------------------------------------------------------

  const startMicLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    // Mobile mics pick up more background noise — use higher thresholds
    // to avoid false speech detection from ambient sound.
    const mobile = isMobileDevice();
    const speechStart = mobile ? SPEECH_START_THRESHOLD * 1.8 : SPEECH_START_THRESHOLD;
    const silence = mobile ? SILENCE_THRESHOLD * 2.5 : SILENCE_THRESHOLD;
    // Require sustained speech (not a brief noise spike) before triggering
    let speechHitCount = 0;
    const SPEECH_HITS_REQUIRED = mobile ? 4 : 2;

    const tick = () => {
      const state = voiceStateRef.current;
      if (
        !activeRef.current ||
        (state !== "listening" && state !== "speech_detected")
      ) {
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

      // Update listening duration
      if (listeningStartMsRef.current) {
        setListeningDurationMs(Date.now() - listeningStartMsRef.current);
      }

      // Speech detection state machine — require sustained signal to
      // avoid triggering on transient noise (especially on mobile)
      if (!speechDetectedRef.current && level > speechStart) {
        speechHitCount++;
        if (speechHitCount >= SPEECH_HITS_REQUIRED) {
          speechDetectedRef.current = true;
          setVoiceState("speech_detected");
          voiceStateRef.current = "speech_detected";
          setActivity({ type: "speech_detected", durationMs: 0 });
        }
      } else if (!speechDetectedRef.current) {
        speechHitCount = 0;
      }

      if (speechDetectedRef.current) {
        if (level > silence) {
          // Voice still present — reset silence timer
          if (silenceTimerRef.current !== null) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (silenceTimerRef.current === null) {
          // Start silence timer
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
    if (current !== "idle" && current !== "error" && current !== "complete") {
      console.debug("[LiTT Voice] startVoice ignored — state:", current);
      return;
    }

    console.debug("[LiTT Voice] session start");
    setVoiceState("requesting_permission");
    voiceStateRef.current = "requesting_permission";
    setErrorMessage(null);
    setTranscript("");
    setInterimTranscript("");
    setActivity({ type: "requesting_permission" });

    cleanup();

    // Check MediaRecorder support
    if (typeof window === "undefined" || !window.MediaRecorder) {
      setVoiceState("error");
      voiceStateRef.current = "error";
      setActivity({ type: "error", message: "MediaRecorder not supported" });
      setErrorMessage("MediaRecorder not supported in this browser.");
      return;
    }

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      setVoiceState("error");
      voiceStateRef.current = "error";
      setActivity({ type: "error", message: "No supported audio MIME type" });
      setErrorMessage("No supported audio format found in this browser.");
      return;
    }

    // --- getUserMedia ---
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          ...(selectedDeviceId ? { deviceId: selectedDeviceId } : {}),
        },
      });
    } catch (err: unknown) {
      const e = err as DOMException;
      const msg = getUserMediaErrorMessage(e);
      console.error("[LiTT Voice] getUserMedia error:", e.name, msg);
      setVoiceState("error");
      voiceStateRef.current = "error";
      setActivity({ type: "error", message: msg });
      setErrorMessage(msg);
      return;
    }

    console.debug("[LiTT Voice] stream id:", stream.id);
    streamRef.current = stream;
    activeRef.current = true;

    // --- AudioContext + Analyser ---
    setVoiceState("connecting");
    voiceStateRef.current = "connecting";
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
      // non-fatal — mic level won't work but recording can continue
    }

    // --- MediaRecorder ---
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      // Store the actual mimeType the recorder negotiated — may differ from
      // what we requested on some mobile browsers. Used when building the
      // blob for transcription to avoid MIME mismatches.
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
        setVoiceState("error");
        voiceStateRef.current = "error";
        setActivity({ type: "error", message: "Recording error" });
        setErrorMessage("Recording error. Please try again.");
      };

      recorder.start(CHUNK_INTERVAL_MS);
      listeningStartMsRef.current = Date.now();
      setListeningDurationMs(0);
      setVoiceState("listening");
      voiceStateRef.current = "listening";
      setActivity({ type: "listening" });
      startMicLevelLoop();

      // Max recording safety net
      maxRecordingTimerRef.current = setTimeout(() => {
        if (
          voiceStateRef.current === "listening" ||
          voiceStateRef.current === "speech_detected"
        ) {
          finalizeRecording();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.error("[LiTT Voice] MediaRecorder start failed:", err);
      setVoiceState("error");
      voiceStateRef.current = "error";
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

  // ---------------------------------------------------------------------------
  // stopVoice
  // ---------------------------------------------------------------------------

  const stopVoice = useCallback(() => {
    console.debug("[LiTT Voice] stopVoice");
    activeRef.current = false;
    setVoiceState("idle");
    voiceStateRef.current = "idle";
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
      if (next) {
        setVoiceState("muted");
        voiceStateRef.current = "muted";
        setActivity({ type: "paused" });
      } else {
        setVoiceState("listening");
        voiceStateRef.current = "listening";
        setActivity({ type: "listening" });
        startMicLevelLoop();
      }
      console.debug("[LiTT Voice] mute toggled:", next);
      return next;
    });
  }, [startMicLevelLoop, setActivity]);

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

      // Pause recording while speaking to avoid echo loops
      if (mediaRecorderRef.current?.state === "recording") {
        try {
          mediaRecorderRef.current.pause();
        } catch {
          // ignore
        }
      }

      setVoiceState("speaking");
      voiceStateRef.current = "speaking";
      setActivity({ type: "speaking" });

      const onSpeechEnd = () => {
        if (ttsCancelledRef.current) return;
        if (mediaRecorderRef.current?.state === "paused") {
          try {
            mediaRecorderRef.current.resume();
          } catch {
            // ignore
          }
        }
        if (activeRef.current) {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          setActivity({ type: "listening" });
          startMicLevelLoop();
        } else {
          setVoiceState("idle");
          voiceStateRef.current = "idle";
          setActivity({ type: "idle" });
        }
      };

      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "aoede" }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`TTS ${res.status}`);
          const blob = await res.blob();
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
    [stopSpeaking, startMicLevelLoop, setActivity],
  );

  // ---------------------------------------------------------------------------

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
      setVoiceState("listening");
      voiceStateRef.current = "listening";
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
      isMuted,
      selectedDeviceId,
      availableDevices,
      listeningDurationMs,
      activity,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
      setActivity,
    }),
    [
      voiceState,
      state,
      transcript,
      interimTranscript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      listeningDurationMs,
      activity,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
      setOnTurn,
      setActivity,
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
