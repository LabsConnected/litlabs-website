"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

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
  const recognitionRef = useRef<LiTSpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

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
      rec.onstart = () => setState("listening");
      rec.onend = () => setState("idle");
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
        const transcript = last[0].transcript;
        if (last.isFinal) {
          setState("thinking");
          onTranscript(transcript);
        }
      };
      recognitionRef.current = rec;
    }
    synthRef.current = window.speechSynthesis;
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, [onTranscript]);

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
  }, []);

  const speak = useCallback((text: string) => {
    if (!synthRef.current || typeof window === "undefined") return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 1.0;
    utter.onstart = () => setState("speaking");
    utter.onend = () => setState("idle");
    utter.onerror = () => setState("idle");
    synthRef.current.cancel();
    synthRef.current.speak(utter);
  }, []);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setState("idle");
  }, []);

  return {
    state,
    isSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
