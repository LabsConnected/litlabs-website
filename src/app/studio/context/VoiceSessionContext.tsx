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
// SpeechRecognition type shim (not in lib.dom.d.ts by default)
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

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
const SILENCE_TIMEOUT_MS = 900;

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
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false); // true while a session is live
  const voiceStateRef = useRef<VoiceState>("idle"); // mirror for RAF/async callbacks
  const onTurnRef = useRef<(text: string) => void>(noop);
  const prevMicLevelRef = useRef(0);
  const submittedTranscriptRef = useRef("");

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

    // 3. Abort SpeechRecognition
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      if (recorderRef.current.state === "recording") recorderRef.current.stop();
      recorderRef.current = null;
      recorderChunksRef.current = [];
    }

    // 4. Stop TTS
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }

    // 5. Cancel RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // 6. Clear silence timer
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
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
  // Mic level RAF loop
  // ---------------------------------------------------------------------------

  const startMicLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      const state = voiceStateRef.current;
      if (state !== "listening" && state !== "user_speaking") {
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
      const level = Math.min(1, rms * 2.5);

      if (Math.abs(level - prevMicLevelRef.current) > 0.02) {
        prevMicLevelRef.current = level;
        setMicLevel(level);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

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
    cleanup();

    // --- getUserMedia ---
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException(
          "This browser cannot access microphones. Use a current version of Chrome, Edge, or Firefox.",
          "NotSupportedError",
        );
      }

      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        ...(selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : {}),
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (deviceError) {
        const deviceException = deviceError as DOMException;
        const savedDeviceIsStale =
          Boolean(selectedDeviceId) &&
          (deviceException.name === "NotFoundError" ||
            deviceException.name === "OverconstrainedError" ||
            deviceException.name === "DevicesNotFoundError");

        if (!savedDeviceIsStale) throw deviceError;

        localStorage.removeItem(DEVICE_STORAGE_KEY);
        setSelectedDeviceId(null);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
      }
    } catch (err: unknown) {
      const e = err as DOMException;
      let msg = "Microphone error.";
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        msg =
          "Microphone permission denied. Please allow access in browser settings and check for hardware privacy switches.";
      } else if (
        e.name === "NotFoundError" ||
        e.name === "DevicesNotFoundError"
      ) {
        msg = "No microphone found.";
      } else if (
        e.name === "NotReadableError" ||
        e.name === "TrackStartError"
      ) {
        msg = "Microphone is in use by another application.";
      } else if (e.name === "NotSupportedError") {
        msg = e.message;
      } else if (e.message) {
        msg = e.message;
      }
      console.error("[Voice] getUserMedia error:", e.name, msg);
      setVoiceState("error");
      voiceStateRef.current = "error";
      setErrorMessage(msg);
      return;
    }

    console.debug("[Voice] stream id:", stream.id);
    activeStream = stream;
    streamRef.current = stream;
    activeRef.current = true;
    await enumerateDevices();

    // --- AudioContext + Analyser ---
    setVoiceState("connecting");
    voiceStateRef.current = "connecting";

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
      console.warn("[Voice] AudioContext setup failed:", err);
      // non-fatal — mic level won't work but recognition can continue
    }

    // --- SpeechRecognition ---
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      try {
        const preferredType = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
        ].find((type) => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(
          stream,
          preferredType ? { mimeType: preferredType } : undefined,
        );
        recorderRef.current = recorder;
        recorderChunksRef.current = [];
        setVoiceMode("recording");
        recorder.ondataavailable = (event) => {
          if (event.data.size) recorderChunksRef.current.push(event.data);
        };
        recorder.onerror = () => {
          setVoiceState("error");
          voiceStateRef.current = "error";
          setErrorMessage("This browser could not record the selected microphone.");
        };
        recorder.onstop = async () => {
          const chunks = recorderChunksRef.current;
          recorderChunksRef.current = [];
          if (!chunks.length) {
            setVoiceState("error");
            voiceStateRef.current = "error";
            setErrorMessage("No audio was captured. Check your microphone and try again.");
            cleanup();
            return;
          }
          setVoiceState("processing");
          voiceStateRef.current = "processing";
          setTiming({ recordingEndedAt: Date.now(), transcriptionStartedAt: Date.now() });
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            const dataUrl = await blobToDataUrl(blob);
            const response = await fetch("/api/media/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audioBytes: dataUrl.split(",")[1],
                mimeType: blob.type,
              }),
            });
            const data = (await response.json()) as { text?: string; error?: string };
            if (!response.ok || !data.text?.trim()) {
              throw new Error(data.error || "No speech was detected.");
            }
            const spokenText = data.text.trim();
            setTranscript(spokenText);
            setTiming({ transcriptionCompletedAt: Date.now(), aiResponseStartedAt: Date.now() });
            onTurnRef.current(spokenText);
            setTiming({ aiResponseCompletedAt: Date.now() });
            setVoiceState("idle");
            voiceStateRef.current = "idle";
            setVoiceMode(null);
            cleanup();
          } catch (error) {
            setVoiceState("error");
            voiceStateRef.current = "error";
            setErrorMessage(
              error instanceof Error ? error.message : "Voice transcription failed.",
            );
            cleanup();
          }
        };
        recorder.start(250);
        setVoiceState("listening");
        voiceStateRef.current = "listening";
        startMicLevelLoop();
      } catch (error) {
        setVoiceState("error");
        voiceStateRef.current = "error";
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Voice recording is not supported in this browser.",
        );
        cleanup();
      }
      return;
    }

    setVoiceMode("live");

    const buildRecognition = () => {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onstart = () => {
        console.debug("[Voice] recognition started");
        setVoiceState("listening");
        voiceStateRef.current = "listening";
        startMicLevelLoop();
      };

      rec.onresult = (ev: SpeechRecognitionEvent) => {
        let finalText = "";
        let interimText = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) {
            finalText += r[0].transcript;
          } else {
            interimText += r[0].transcript;
          }
        }
        const combined = (finalText + interimText).trim();
        setTranscript(combined);

        if (combined) {
          setVoiceState("user_speaking");
          voiceStateRef.current = "user_speaking";

          // Reset silence timer
          if (silenceTimerRef.current !== null) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = null;
            const t = combined.trim();
            if (t && t !== submittedTranscriptRef.current) {
              submittedTranscriptRef.current = t;
              console.debug("[Voice] silence detected, turn:", t);
              activeRef.current = false;
              setVoiceState("processing");
              voiceStateRef.current = "processing";
              setTiming({ recordingEndedAt: Date.now(), transcriptionCompletedAt: Date.now(), aiResponseStartedAt: Date.now() });
              cleanup();
              onTurnRef.current(t);
              setTiming({ aiResponseCompletedAt: Date.now() });
              setVoiceState("idle");
              voiceStateRef.current = "idle";
              setVoiceMode(null);
            }
          }, SILENCE_TIMEOUT_MS);
        }
      };

      rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
        if (ev.error === "aborted" || ev.error === "no-speech") return;
        console.error("[Voice] recognition error:", ev.error);
        setVoiceState("error");
        voiceStateRef.current = "error";
        setErrorMessage(`Speech recognition error: ${ev.error}`);
      };

      rec.onend = () => {
        console.debug("[Voice] recognition ended, active:", activeRef.current);
        const shouldRestart =
          activeRef.current &&
          voiceStateRef.current !== "assistant_speaking" &&
          voiceStateRef.current !== "muted" &&
          voiceStateRef.current !== "error";

        if (shouldRestart) {
          setTimeout(() => {
            if (activeRef.current && recognitionRef.current === rec) {
              try {
                rec.start();
              } catch {
                // recognition may already be restarted or closed
              }
            }
          }, 500);
        }
      };

      return rec;
    };

    const rec = buildRecognition();
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      console.error("[Voice] recognition.start() failed:", err);
    }
  }, [cleanup, enumerateDevices, selectedDeviceId, startMicLevelLoop]);

  // ---------------------------------------------------------------------------
  // stopVoice
  // ---------------------------------------------------------------------------

  const stopVoice = useCallback(() => {
    console.debug("[Voice] stopVoice");
    if (recorderRef.current?.state === "recording") {
      setVoiceState("processing");
      voiceStateRef.current = "processing";
      recorderRef.current.stop();
      return;
    }
    activeRef.current = false;
    setVoiceState("idle");
    voiceStateRef.current = "idle";
    cleanup();
    setTranscript("");
    setMicLevel(0);
    setVoiceMode(null);
    submittedTranscriptRef.current = "";
    prevMicLevelRef.current = 0;
  }, [cleanup]);

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
      } else {
        setVoiceState("listening");
        voiceStateRef.current = "listening";
        startMicLevelLoop();
      }
      console.debug("[Voice] mute toggled:", next);
      return next;
    });
  }, [startMicLevelLoop]);

  // ---------------------------------------------------------------------------
  // stopSpeaking
  // ---------------------------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // speakText
  // ---------------------------------------------------------------------------

  const speakText = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      const sanitized = sanitizeSpeech(text);
      if (!sanitized) return;

      // Stop any current TTS first (barge-in)
      stopSpeaking();

      // Pause recognition while speaking to avoid echo loops
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }

      setVoiceState("assistant_speaking");
      voiceStateRef.current = "assistant_speaking";
      setTiming({ ttsStartedAt: Date.now() });

      const onSpeechEnd = () => {
        setTiming({ playbackEndedAt: Date.now() });
        if (activeRef.current) {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          startMicLevelLoop();
          // Resume recognition after assistant finished speaking
          try {
            recognitionRef.current?.start();
          } catch {
            // ignore
          }
        } else {
          setVoiceState("idle");
          voiceStateRef.current = "idle";
        }
      };

      // Try streaming TTS via /api/voice/speak (ElevenLabs)
      fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sanitized, agentId: "litt" }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`API ${res.status}`);
          setTiming({ ttsFirstByteAt: Date.now() });

          const audioBlob = await res.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          currentAudioRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            onSpeechEnd();
          };

          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            console.warn(
              "[Voice] HTMLAudio error — falling back to speechSynthesis",
            );
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            fallbackSynth(sanitized, onSpeechEnd);
          };

          setTiming({ playbackStartedAt: Date.now() });
          try {
            await audio.play();
          } catch (err) {
            console.warn("[Voice] audio.play() blocked:", err);
            fallbackSynth(sanitized, onSpeechEnd);
          }
        })
        .catch((err) => {
          console.warn(
            "[Voice] /api/voice/speak failed:",
            err,
            "— falling back to /api/media/generate-audio",
          );
          // Fallback to old generate-audio endpoint
          fetch("/api/media/generate-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: sanitized, voice: "Kore" }),
          })
            .then(async (res2) => {
              if (!res2.ok) throw new Error(`API ${res2.status}`);
              const data = (await res2.json()) as {
                audioBase64?: string;
                audioUrl?: string;
              };

              let src = "";
              if (data.audioBase64) {
                src = data.audioBase64.startsWith("data:")
                  ? data.audioBase64
                  : `data:audio/mpeg;base64,${data.audioBase64}`;
              } else if (data.audioUrl) {
                src = data.audioUrl;
              } else {
                throw new Error("No audio data in response");
              }

              const audio = new Audio(src);
              currentAudioRef.current = audio;
              setTiming({ playbackStartedAt: Date.now() });

              audio.onended = () => {
                if (currentAudioRef.current === audio) {
                  currentAudioRef.current = null;
                }
                onSpeechEnd();
              };

              audio.onerror = () => {
                if (currentAudioRef.current === audio) {
                  currentAudioRef.current = null;
                }
                fallbackSynth(sanitized, onSpeechEnd);
              };

              try {
                await audio.play();
              } catch {
                fallbackSynth(sanitized, onSpeechEnd);
              }
            })
            .catch(() => {
              fallbackSynth(sanitized, onSpeechEnd);
            });
        });
    },
    [stopSpeaking, startMicLevelLoop, setTiming],
  );

  // ---------------------------------------------------------------------------
  // interrupt
  // ---------------------------------------------------------------------------

  const interrupt = useCallback(() => {
    console.debug("[Voice] interrupt");
    stopSpeaking();
    if (activeRef.current) {
      setVoiceState("listening");
      voiceStateRef.current = "listening";
      startMicLevelLoop();
      try {
        recognitionRef.current?.start();
      } catch {
        // ignore
      }
    }
  }, [stopSpeaking, startMicLevelLoop]);

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

// ---------------------------------------------------------------------------
// Helpers (module-level, not closures, so they don't capture stale refs)
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error || new Error("Could not read microphone audio."));
    reader.readAsDataURL(blob);
  });
}
