"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

interface LiTSpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface LiTSpeechRecognitionResultItem {
  transcript: string;
}

interface LiTSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: LiTSpeechRecognitionResultItem;
}

interface LiTSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: LiTSpeechRecognitionResult;
}

interface LiTSpeechRecognitionEvent extends Event {
  readonly results: LiTSpeechRecognitionResultList;
}

interface LiTSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: LiTSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: LiTSpeechRecognitionEvent) => void) | null;
  start: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => LiTSpeechRecognition;
    webkitSpeechRecognition?: new () => LiTSpeechRecognition;
  }
}

interface BrowserWindow extends Window {
  SpeechRecognition?: new () => LiTSpeechRecognition;
  webkitSpeechRecognition?: new () => LiTSpeechRecognition;
}

const LS_VOICE_NAME = "litlabs-voice-name";
const LS_VOICE_RATE = "litlabs-voice-rate";
const LS_VOICE_PITCH = "litlabs-voice-pitch";
const LS_VOICE_CONTINUOUS = "litlabs-voice-continuous";

function getLSNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

function getLSBool(key: string) {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "true";
}

export function useLiTVoice({
  onTranscript,
  onStateChange,
}: {
  onTranscript: (text: string) => void;
  onStateChange?: (state: VoiceState) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [isSupported, setIsSupported] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [rate, setRateState] = useState<number>(() => getLSNumber(LS_VOICE_RATE, 1.05));
  const [pitch, setPitchState] = useState<number>(() => getLSNumber(LS_VOICE_PITCH, 1.0));
  const [continuous, setContinuousState] = useState<boolean>(() => getLSBool(LS_VOICE_CONTINUOUS));
  const recognitionRef = useRef<LiTSpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const pickBestVoice = useCallback((loaded: SpeechSynthesisVoice[]) => {
    const savedName = typeof window !== "undefined" ? window.localStorage.getItem(LS_VOICE_NAME) : null;
    const saved = savedName ? loaded.find((v) => v.name === savedName) : null;
    const preferred = loaded.find((v) =>
      v.lang.startsWith("en") &&
      (/Google US English/i.test(v.name) || /Samantha/i.test(v.name) || /Daniel/i.test(v.name))
    );
    const fallback = loaded.find((v) => v.lang.startsWith("en") && v.default);
    return saved || preferred || fallback || loaded[0] || null;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const win = window as unknown as BrowserWindow;
    const SpeechRecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (SpeechRecognitionCtor) {
      setIsSupported(true);
      const rec = new SpeechRecognitionCtor();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onstart = () => {
        setTranscript("");
        setState("listening");
      };
      rec.onend = () => {
        setState((prev) => (prev === "listening" ? "idle" : prev));
      };
      rec.onerror = (e: LiTSpeechRecognitionErrorEvent) => {
        if (e.error !== "aborted" && e.error !== "no-speech") {
          setState("error");
        } else {
          setState("idle");
        }
      };
      rec.onresult = (e: LiTSpeechRecognitionEvent) => {
        const results = e.results;
        if (!results.length) return;
        const last = results[results.length - 1];
        const text = last[0].transcript;
        setTranscript(text);
        if (last.isFinal) {
          setState("thinking");
          onTranscriptRef.current(text);
        }
      };
      recognitionRef.current = rec;
    }

    const synth = window.speechSynthesis;
    synthRef.current = synth;

    const loadVoices = () => {
      const loaded = synth.getVoices();
      setVoices(loaded);
      if (loaded.length) setSelectedVoice(pickBestVoice(loaded));
    };
    loadVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices;
    }

    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try {
        recognitionRef.current?.abort();
      } catch {
        void 0;
      }
      synthRef.current?.cancel();
      if (synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = null;
      }
    };
  }, [pickBestVoice]);

  useEffect(() => {
    onStateChangeRef.current?.(state);
  }, [state]);

  const setRate = useCallback((v: number) => {
    setRateState(v);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_VOICE_RATE, String(v));
  }, []);

  const setPitch = useCallback((v: number) => {
    setPitchState(v);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_VOICE_PITCH, String(v));
  }, []);

  const setContinuous = useCallback((v: boolean) => {
    setContinuousState(v);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_VOICE_CONTINUOUS, String(v));
  }, []);

  const setVoice = useCallback((voice: SpeechSynthesisVoice | null) => {
    setSelectedVoice(voice);
    if (typeof window !== "undefined") {
      if (voice) window.localStorage.setItem(LS_VOICE_NAME, voice.name);
      else window.localStorage.removeItem(LS_VOICE_NAME);
    }
  }, []);

  const clearRestart = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const startListening = useCallback(() => {
    clearRestart();
    if (!recognitionRef.current) {
      setState("error");
      return;
    }
    try {
      synthRef.current?.cancel();
      setTranscript("");
      setState("listening");
      recognitionRef.current.start();
    } catch {
      void 0;
    }
  }, [clearRestart]);

  const stopListening = useCallback(() => {
    clearRestart();
    try {
      recognitionRef.current?.abort();
    } catch {
      void 0;
    }
    setState("idle");
    setTranscript("");
  }, [clearRestart]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (text: string) => {
    if (typeof window === "undefined") return;
    clearRestart();
    synthRef.current?.cancel();

    // Check if user selected a premium Gemini voice
    const provider = typeof window !== "undefined" ? window.localStorage.getItem("litlabs-voice-provider") : "system";
    const geminiVoice = typeof window !== "undefined" ? window.localStorage.getItem("litlabs-gemini-voice") || "Kore" : "Kore";

    if (provider === "gemini") {
      try {
        setState("speaking");
        const res = await fetch("/api/media/generate-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, voice: geminiVoice }),
        });
        const data = await res.json();
        if (data.audioBase64) {
          const audio = new Audio(data.audioBase64);
          audioRef.current = audio;
          audio.onended = () => {
            setState("idle");
            if (continuous) {
              restartTimerRef.current = setTimeout(() => startListening(), 400);
            }
          };
          audio.onerror = () => setState("idle");
          await audio.play();
        } else {
          setState("idle");
        }
      } catch {
        setState("idle");
      }
      return;
    }

    if (!synthRef.current) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    utter.pitch = pitch;
    if (selectedVoice) utter.voice = selectedVoice;
    utter.onstart = () => setState("speaking");
    utter.onend = () => {
      setState("idle");
      if (continuous) {
        restartTimerRef.current = setTimeout(() => startListening(), 400);
      }
    };
    utter.onerror = () => setState("idle");
    synthRef.current.speak(utter);
  }, [selectedVoice, rate, pitch, continuous, startListening, clearRestart]);

  const stopSpeaking = useCallback(() => {
    clearRestart();
    synthRef.current?.cancel();
    try {
      audioRef.current?.pause();
      audioRef.current = null;
    } catch {
      void 0;
    }
    setState("idle");
  }, [clearRestart]);

  return {
    state,
    transcript,
    isSupported,
    voices,
    selectedVoice,
    rate,
    pitch,
    continuous,
    setVoice,
    setRate,
    setPitch,
    setContinuous,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
