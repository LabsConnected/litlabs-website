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
  // Actions
  startVoice: () => void;
  stopVoice: () => void;
  toggleMute: () => void;
  interrupt: () => void;
  speakText: (text: string) => void;
  stopSpeaking: () => void;
  selectDevice: (deviceId: string) => void;
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
  startVoice: noop,
  stopVoice: noop,
  toggleMute: noop,
  interrupt: noop,
  speakText: noop,
  stopSpeaking: noop,
  selectDevice: noop,
};

export const VoiceSessionContext = createContext<VoiceSessionCtx>(defaultCtx);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEVICE_STORAGE_KEY = "litt:voice:deviceId";
const SILENCE_TIMEOUT_MS = 1200;

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

  // --- Refs ---
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false); // true while a session is live
  const voiceStateRef = useRef<VoiceState>("idle"); // mirror for RAF/async callbacks
  const onTurnRef = useRef<(text: string) => void>(noop);
  const prevMicLevelRef = useRef(0);

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

    // Always clean up before starting
    cleanup();

    // --- getUserMedia ---
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          ...(selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : {}),
        },
      });
    } catch (err: unknown) {
      const e = err as DOMException;
      let msg = "Microphone error.";
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        msg = "Microphone permission denied.";
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

    // --- AudioContext + Analyser ---
    setVoiceState("connecting");
    voiceStateRef.current = "connecting";

    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
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
      setVoiceState("error");
      voiceStateRef.current = "error";
      setErrorMessage("Speech recognition is not supported in this browser.");
      cleanup();
      return;
    }

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
        for (let i = 0; i < ev.results.length; i++) {
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
            const t = combined;
            if (t) {
              console.debug("[Voice] silence detected, turn:", t);
              onTurnRef.current(t);
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
        if (activeRef.current) {
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
  }, [cleanup, selectedDeviceId, startMicLevelLoop]);

  // ---------------------------------------------------------------------------
  // stopVoice
  // ---------------------------------------------------------------------------

  const stopVoice = useCallback(() => {
    console.debug("[Voice] stopVoice");
    activeRef.current = false;
    setVoiceState("idle");
    voiceStateRef.current = "idle";
    cleanup();
    setTranscript("");
    setMicLevel(0);
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

      // Stop any current TTS first
      stopSpeaking();

      setVoiceState("assistant_speaking");
      voiceStateRef.current = "assistant_speaking";

      const onSpeechEnd = () => {
        if (activeRef.current) {
          setVoiceState("listening");
          voiceStateRef.current = "listening";
          startMicLevelLoop();
        } else {
          setVoiceState("idle");
          voiceStateRef.current = "idle";
        }
      };

      // Try API audio first
      fetch("/api/media/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, voice: "Puck" }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`API ${res.status}`);
          const data = (await res.json()) as {
            audioBase64?: string;
            audioUrl?: string;
          };

          let src = "";
          if (data.audioBase64) {
            src = `data:audio/mpeg;base64,${data.audioBase64}`;
          } else if (data.audioUrl) {
            src = data.audioUrl;
          } else {
            throw new Error("No audio data in response");
          }

          const audio = new Audio(src);
          currentAudioRef.current = audio;

          audio.onended = () => {
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            onSpeechEnd();
          };

          audio.onerror = () => {
            console.warn(
              "[Voice] HTMLAudio error — falling back to speechSynthesis",
            );
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            fallbackSynth(text, onSpeechEnd);
          };

          try {
            await audio.play();
          } catch (err) {
            console.warn("[Voice] audio.play() blocked:", err);
            fallbackSynth(text, onSpeechEnd);
          }
        })
        .catch((err) => {
          console.warn(
            "[Voice] generate-audio API failed:",
            err,
            "— falling back to speechSynthesis",
          );
          fallbackSynth(text, onSpeechEnd);
        });
    },
    [stopSpeaking, startMicLevelLoop],
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
      // Restart recognition if needed
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // may already be stopped
        }
      }
      startMicLevelLoop();
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

  const ctx = useMemo<VoiceSessionCtx>(
    () => ({
      voiceState,
      transcript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
    }),
    [
      voiceState,
      transcript,
      micLevel,
      errorMessage,
      isMuted,
      selectedDeviceId,
      availableDevices,
      startVoice,
      stopVoice,
      toggleMute,
      interrupt,
      speakText,
      stopSpeaking,
      selectDevice,
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
