"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

type VoiceInfo = {
  name: string;
  lang: string;
};

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
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const recognitionRef = useRef<LiTSpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  const pickBestVoice = useCallback((voices: SpeechSynthesisVoice[]) => {
    const preferred = voices.find((v) =>
      v.lang.startsWith("en") &&
      (/Google US English/i.test(v.name) || /Samantha/i.test(v.name) || /Daniel/i.test(v.name))
    );
    const fallback = voices.find((v) => v.lang.startsWith("en") && v.default);
    return preferred || fallback || voices[0] || null;
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
          onTranscript(text);
        }
      };
      recognitionRef.current = rec;
    }

    const synth = window.speechSynthesis;
    synthRef.current = synth;

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length) setSelectedVoice(pickBestVoice(voices));
    };
    loadVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices;
    }

    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      if (synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = null;
      }
    };
  }, [onTranscript, pickBestVoice]);

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      setState("error");
      return;
    }
    try {
      synthRef.current?.cancel();
      setTranscript("");
      recognitionRef.current.start();
    } catch {
      // already started or not allowed
    }
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }
    setState("idle");
    setTranscript("");
  }, []);

  const speak = useCallback((text: string) => {
    if (!synthRef.current || typeof window === "undefined") return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 1.0;
    if (selectedVoice) utter.voice = selectedVoice;
    utter.onstart = () => setState("speaking");
    utter.onend = () => setState("idle");
    utter.onerror = () => setState("idle");
    synthRef.current.cancel();
    synthRef.current.speak(utter);
  }, [selectedVoice]);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setState("idle");
  }, []);

  return {
    state,
    transcript,
    isSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
