"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, PhoneOff, Volume2, VolumeX, Send } from "lucide-react";
import { useMediaPermissions } from "../hooks/useMediaPermissions";

export type VoiceState =
  | "idle"
  | "requesting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

interface VoiceSessionProps {
  onSend: (text: string) => Promise<string>;
  onClose?: () => void;
}

type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
  length: number;
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResult[];
};
type SpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

const WAVE_BARS = [12, 18, 26, 14, 30, 20, 24, 16, 28, 22, 18, 14];
const MAX_RETRIES = 3;

export default function VoiceSession({ onSend, onClose }: VoiceSessionProps) {
  const { lastError } = useMediaPermissions();
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingRef = useRef(false);
  const activeRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const latestTranscriptRef = useRef("");

  // Refs break circular dependencies between callbacks.
  const runTurnRef = useRef<(text: string) => Promise<void>>(async () => {});
  const speakRef = useRef<(text: string) => void>(() => {});
  const scheduleRestartRef = useRef<(delay: number) => void>(() => {});
  const startListeningRef = useRef<() => void>(() => {});

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const scheduleRestart = useCallback((delay: number) => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (!activeRef.current) return;
    if (retryCountRef.current >= MAX_RETRIES) {
      setState("error");
      return;
    }
    restartTimerRef.current = setTimeout(() => {
      retryCountRef.current += 1;
      startListeningRef.current();
    }, delay);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!speakerOn || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 1;
      utter.onstart = () => {
        speakingRef.current = true;
        setState("speaking");
      };
      utter.onend = () => {
        speakingRef.current = false;
        setState("idle");
        scheduleRestartRef.current(600);
      };
      utter.onerror = () => {
        speakingRef.current = false;
        setState("idle");
        scheduleRestartRef.current(600);
      };
      window.speechSynthesis.speak(utter);
    },
    [speakerOn],
  );

  const runTurn = useCallback(
    async (finalText: string) => {
      if (!finalText.trim()) return;
      setTranscript("");
      setInterim("");
      setState("transcribing");
      await new Promise((r) => setTimeout(r, 120));
      setState("thinking");
      try {
        const reply = await onSend(finalText.trim());
        if (reply) speakRef.current(reply);
        else setState("idle");
      } catch {
        setState("error");
      }
    },
    [onSend],
  );

  const startListening = useCallback(() => {
    activeRef.current = true;
    retryCountRef.current = 0;
    if (muted) setMuted(false);
    setState("requesting");

    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognition })
        .SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognition;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setState("error");
      return;
    }

    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onstart = () => {
      setState("listening");
    };

    rec.onresult = (event) => {
      if (speakingRef.current) {
        window.speechSynthesis.cancel();
        speakingRef.current = false;
      }
      let final = "";
      let currentInterim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          currentInterim += result[0].transcript;
        }
      }
      if (final) {
        setTranscript((prev) => {
          const updated = prev + final;
          latestTranscriptRef.current = updated;
          return updated;
        });
      }
      setInterim(currentInterim);

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const text =
          (latestTranscriptRef.current ?? "") +
          (currentInterim ? " " + currentInterim : "");
        if (text.trim()) void runTurnRef.current(text.trim());
      }, 1300);
    };

    rec.onerror = (event) => {
      if (event.error === "aborted") return;
      setState("error");
    };

    rec.onend = () => {
      if (!speakingRef.current) {
        setState("idle");
        scheduleRestartRef.current(800);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      setState("error");
    }
  }, [muted]);

  // Keep latest callback references available to event handlers without
  // creating circular useCallback dependencies.
  useEffect(() => {
    scheduleRestartRef.current = scheduleRestart;
    speakRef.current = speak;
    runTurnRef.current = runTurn;
    startListeningRef.current = startListening;
  }, [scheduleRestart, speak, runTurn, startListening]);

  const handleClose = useCallback(() => {
    activeRef.current = false;
    stopRecognition();
    window.speechSynthesis?.cancel();
    speakingRef.current = false;
    setState("idle");
    onClose?.();
  }, [onClose, stopRecognition]);

  useEffect(() => {
    return () => {
      stopRecognition();
      window.speechSynthesis?.cancel();
    };
  }, [stopRecognition]);

  const statusText =
    {
      idle: "Ready",
      requesting: "Requesting microphone…",
      listening: "Listening…",
      transcribing: "Transcribing…",
      thinking: "LiTT is thinking…",
      speaking: "LiTT is speaking…",
      error: "Voice error",
    }[state] || state;

  if (state === "idle") {
    return (
      <button
        onClick={() => startListeningRef.current()}
        className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-300"
      >
        <Mic size={14} /> Start voice
      </button>
    );
  }

  if (state === "requesting") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-xs text-cyan-300">
        <Mic size={16} className="animate-pulse" />
        {statusText}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-xs text-red-200">
        <div className="flex items-center gap-2 font-bold">
          <MicOff size={14} /> Voice unavailable
        </div>
        <p>{lastError?.message || "Could not access the microphone."}</p>
        <div className="flex gap-2">
          <button
            onClick={() => startListeningRef.current()}
            className="rounded-full bg-red-400/20 px-3 py-1 text-red-200"
          >
            Try again
          </button>
          <button
            onClick={handleClose}
            className="rounded-full border border-red-400/30 px-3 py-1 text-red-200"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const displayText = transcript || interim;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-cyan-400/30 bg-[#0a0f1c] p-4 shadow-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-2 w-2 rounded-full animate-pulse ${state === "listening" ? "bg-red-500" : "bg-cyan-400"}`}
          />
          <span className="text-xs font-black uppercase tracking-wider text-white">
            {statusText}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="rounded-full p-1.5 text-slate-400 hover:bg-white/10"
          title="End voice session"
        >
          <PhoneOff size={16} />
        </button>
      </div>

      <div className="min-h-10 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
        {displayText || (
          <span className="text-slate-500">
            {state === "speaking" ? "LiTT is responding…" : "Say something…"}
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-1 py-2">
        {WAVE_BARS.map((h, i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-cyan-300"
            style={{
              height: state === "listening" ? `${h}px` : "8px",
              opacity: state === "listening" ? 1 : 0.4,
              animationDelay: `${i * 60}ms`,
            }}
          />
        ))}
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setMuted((v) => !v)}
          className="rounded-full border border-white/20 p-2 text-slate-300 hover:bg-white/10"
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button
          onClick={() => {
            void runTurnRef.current(
              transcript + (interim ? " " + interim : ""),
            );
          }}
          disabled={!transcript && !interim}
          className="rounded-full bg-cyan-500 px-4 py-2 text-xs font-black text-black disabled:opacity-40"
        >
          <Send size={14} className="inline mr-1" /> Send
        </button>
        <button
          onClick={() => setSpeakerOn((v) => !v)}
          className="rounded-full border border-white/20 p-2 text-slate-300 hover:bg-white/10"
          title={speakerOn ? "Speaker on" : "Speaker off"}
        >
          {speakerOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </div>
    </div>
  );
}
