"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useLiTVoice } from "@/hooks/useLiTVoice";
import { Mic, MicOff, X, Send, AlertCircle } from "lucide-react";

type VoiceOverlayProps = {
  onClose: () => void;
  onSend: (text: string) => void | Promise<void>;
};

export default function LiTVoiceOverlay({ onClose, onSend }: VoiceOverlayProps) {
  const { resolvedColors: T } = useTheme();
  const [status, setStatus] = useState<"idle" | "listening" | "thinking" | "speaking" | "error">("idle");
  const [text, setText] = useState("");
  const [fallback, setFallback] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { startListening, stopListening, stopSpeaking, isSupported } = useLiTVoice({
    onTranscript: (transcript: string) => {
      setText(transcript);
    },
    onStateChange: (state) => {
      if (state === "thinking" || state === "speaking" || state === "idle" || state === "error" || state === "listening") {
        setStatus(state);
      }
      if (state === "error") {
        setErrorMsg("Mic failed. Check browser permissions or use text.");
      }
    },
  });

  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
    };
  }, [stopListening, stopSpeaking]);

  const handleStart = () => {
    setErrorMsg(null);
    setText("");
    startListening();
  };

  const handleStop = () => {
    stopListening();
    if (text.trim()) {
      sendToLiT(text.trim());
    } else {
      setStatus("idle");
    }
  };

  const sendToLiT = async (prompt: string) => {
    setStatus("thinking");
    try {
      await onSend(prompt);
      setStatus("speaking");
    } catch {
      setStatus("error");
      setErrorMsg("Failed to reach LiT. Try again.");
    }
  };

  const submitFallback = async () => {
    if (!fallback.trim()) return;
    const t = fallback.trim();
    setFallback("");
    await sendToLiT(t);
  };

  const isListening = status === "listening";

  const statusText = {
    idle: "Tap the mic and start talking.",
    listening: "Listening…",
    thinking: "LiT is thinking…",
    speaking: "LiT is speaking…",
    error: errorMsg || "Voice needs attention.",
  }[status];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "rgba(5,5,8,0.98)", backdropFilter: "blur(24px)" }}
    >
      <button
        onClick={onClose}
        className="absolute right-5 top-5 z-10 rounded-full p-2 transition hover:bg-white/10"
        style={{ color: T.textMuted }}
        aria-label="Close voice mode"
      >
        <X size={24} />
      </button>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        {/* Orb */}
        <div className="relative mb-8 flex h-32 w-32 items-center justify-center">
          {isListening && (
            <>
              <span
                className="absolute inset-0 rounded-full animate-ping opacity-25"
                style={{ background: `radial-gradient(circle, ${T.accentColor}, transparent 70%)`, animationDuration: "1.5s" }}
              />
              <span
                className="absolute inset-4 rounded-full animate-pulse opacity-30"
                style={{ background: `radial-gradient(circle, ${T.accentColor}, transparent 70%)`, animationDuration: "1s" }}
              />
            </>
          )}
          <div
            className="relative flex h-24 w-24 items-center justify-center rounded-full border-2"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor}25, ${T.headerColor}15)`,
              borderColor: `${T.accentColor}60`,
              boxShadow: isListening ? `0 0 80px ${T.accentColor}50` : `0 0 40px ${T.accentColor}25`,
            }}
          >
            {status === "error" ? (
              <AlertCircle size={40} style={{ color: "#ff4444" }} />
            ) : status === "speaking" ? (
              <Mic size={40} style={{ color: T.accentColor }} />
            ) : isListening ? (
              <MicOff size={40} style={{ color: "#ff4444" }} />
            ) : (
              <Mic size={40} style={{ color: T.accentColor }} />
            )}
          </div>
        </div>

        {/* Status */}
        <h1 className="text-2xl font-black sm:text-3xl" style={{ color: T.textColor }}>
          LiT Voice
        </h1>
        <p className="mt-2 max-w-xs text-sm" style={{ color: T.textMuted }}>
          {statusText}
        </p>

        {/* Transcript */}
        <div
          className="mt-8 min-h-20 w-full max-w-md rounded-2xl border p-4 text-center"
          style={{ backgroundColor: `${T.boxBg}60`, borderColor: `${T.borderColor}30`, color: T.textColor }}
        >
          {text || (
            <span style={{ color: T.textMuted }}>
              {isSupported ? "Your words will appear here…" : "Voice not supported here. Use text below."}
            </span>
          )}
        </div>

        {/* Big push-to-talk button */}
        <button
          onClick={isListening ? handleStop : handleStart}
          disabled={status === "thinking"}
          className="mt-10 flex h-28 w-28 items-center justify-center rounded-full shadow-2xl transition-all active:scale-95 disabled:opacity-50 sm:h-32 sm:w-32"
          style={{
            backgroundColor: isListening ? "#ff4444" : T.accentColor,
            color: "#000",
            boxShadow: isListening ? "0 0 60px #ff444460" : `0 0 60px ${T.accentColor}50`,
          }}
        >
          {isListening ? <MicOff size={44} /> : <Mic size={44} />}
        </button>

        <p className="mt-4 text-xs" style={{ color: T.textMuted }}>
          {isSupported ? "Push-to-talk. Tap once to speak, tap again to send." : "Your browser does not support voice input."}
        </p>
      </div>

      {/* Fallback text input at bottom */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t px-4 py-4"
        style={{ backgroundColor: T.bgColor, borderColor: `${T.borderColor}30` }}
      >
        <div className="mx-auto flex max-w-md items-center gap-2">
          <input
            type="text"
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitFallback()}
            placeholder="Type instead…"
            className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none"
            style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30`, color: T.textColor }}
          />
          <button
            onClick={submitFallback}
            disabled={!fallback.trim() || status === "thinking"}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition disabled:opacity-50"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
