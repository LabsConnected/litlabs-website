"use client";

import { useEffect, useState } from "react";
import type { VoiceState } from "@/hooks/useLiTVoice";
import { useLitConsoleTheme } from "./useLitConsoleTheme";
import { Mic, MicOff, X, AlertCircle, Repeat, Settings2 } from "lucide-react";

type LiveVoicePanelProps = {
  onClose: () => void;
  state: VoiceState;
  transcript: string;
  errorMessage?: string;
  isSupported: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  continuous: boolean;
  setVoice: (voice: SpeechSynthesisVoice | null) => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setContinuous: (continuous: boolean) => void;
  startListening: () => void;
  stopListening: () => void;
  stopSpeaking: () => void;
};

export default function LiveVoicePanel({
  onClose,
  state,
  transcript,
  errorMessage,
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
  stopSpeaking,
}: LiveVoicePanelProps) {
  const LC = useLitConsoleTheme();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
    };
  }, [stopListening, stopSpeaking]);

  const isListening = state === "listening";

  const statusText: Record<VoiceState, string> = {
    idle: "Tap to speak",
    listening: "Listening…",
    thinking: "LiT is thinking…",
    speaking: "LiT is speaking…",
    error: errorMessage || (isSupported
      ? "Microphone permission denied or unavailable. Allow mic access for litlabs.net, then retry."
      : "Voice input needs a browser with speech recognition, like Chrome on Android."),
  };

  const handleMic = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div
      className="relative z-30 flex w-full shrink-0 flex-col border-t"
      style={{ backgroundColor: `${LC.bg}e6`, backdropFilter: "blur(18px)", borderColor: LC.border }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="rounded-full p-2 transition hover:bg-white/10"
          style={{ color: LC.textMuted }}
          aria-label="Voice settings"
        >
          <Settings2 size={22} />
        </button>
        <button
          onClick={onClose}
          className="rounded-full p-2 transition hover:bg-white/10"
          style={{ color: LC.textMuted }}
          aria-label="Close voice mode"
        >
          <X size={24} />
        </button>
      </div>

      <div className="flex items-center gap-4 px-4 pb-4 pt-2">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
          {isListening && (
            <>
              <span
                className="absolute inset-0 rounded-full animate-ping opacity-20"
                style={{ background: `radial-gradient(circle, ${LC.accentCyan}, transparent 70%)`, animationDuration: "1.5s" }}
              />
              <span
                className="absolute inset-2 rounded-full animate-pulse opacity-25"
                style={{ background: `radial-gradient(circle, ${LC.accentCyan}, transparent 70%)`, animationDuration: "1s" }}
              />
            </>
          )}
          <button
            onClick={handleMic}
            disabled={state === "thinking"}
            className="relative flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all active:scale-95 disabled:opacity-50"
            style={{
              background: `linear-gradient(135deg, ${LC.accentCyan}25, ${LC.bgPanel}40)`,
              borderColor: `${LC.accentCyan}60`,
              boxShadow: isListening ? `0 0 24px ${LC.accentCyan}50` : `0 0 12px ${LC.accentCyan}25`,
              color: LC.accentCyan,
            }}
          >
            {state === "error" ? (
              <AlertCircle size={22} style={{ color: LC.danger }} />
            ) : isListening ? (
              <MicOff size={22} style={{ color: LC.danger }} />
            ) : (
              <Mic size={22} />
            )}
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black" style={{ color: LC.text }}>LiT Voice</span>
            <button
              onClick={() => setContinuous(!continuous)}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition hover:bg-white/5"
              style={{ color: continuous ? LC.accentCyan : LC.textMuted }}
            >
              <Repeat size={10} />
              Continuous {continuous ? "on" : "off"}
            </button>
          </div>
          <p className="text-[11px] leading-snug" style={{ color: state === "error" ? LC.danger : LC.textMuted }}>
            {statusText[state]}
          </p>
          {!isSupported && (
            <p className="mt-1 text-[10px] leading-snug" style={{ color: LC.textDim }}>
              On phone, use Chrome or Samsung Internet and make sure the site is opened over HTTPS.
            </p>
          )}
          <div
            className="mt-2 min-h-9 rounded-xl border px-3 py-2 text-xs leading-snug"
            style={{ backgroundColor: `${LC.bgPanel}80`, borderColor: LC.borderSubtle, color: LC.text }}
          >
            {transcript || (
              <span style={{ color: LC.textDim }}>
                {state === "listening"
                  ? "Listening for words now..."
                  : isSupported
                    ? "Tap the mic and speak. Your words will appear here."
                    : "Voice not supported in this browser."}
              </span>
            )}
          </div>
          {state === "error" && (
            <button
              onClick={handleMic}
              disabled={!isSupported}
              className="mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-all disabled:opacity-50"
              style={{ backgroundColor: LC.accentCyan, color: "#000" }}
            >
              Retry
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <div
          className="fixed bottom-0 left-0 right-0 border-t p-4 sm:left-auto sm:right-4 sm:top-20 sm:w-80 sm:rounded-2xl sm:border"
          style={{ backgroundColor: LC.bgPanel, borderColor: LC.borderSubtle }}
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: LC.text }}>Voice</span>
            <select
              value={selectedVoice?.name || ""}
              onChange={(e) => setVoice(voices.find((v) => v.name === e.target.value) || null)}
              className="max-w-[60%] rounded-lg border px-2 py-1 text-sm outline-none"
              style={{ backgroundColor: LC.bgSecondary, borderColor: LC.borderSubtle, color: LC.text }}
            >
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs" style={{ color: LC.textMuted }}>
              <span>Rate</span>
              <span>{rate.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full"
              style={{ accentColor: LC.accentCyan }}
            />
          </div>

          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs" style={{ color: LC.textMuted }}>
              <span>Pitch</span>
              <span>{pitch.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full"
              style={{ accentColor: LC.accentCyan }}
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between text-sm" style={{ color: LC.text }}>
            <span>Continuous</span>
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => setContinuous(e.target.checked)}
              className="h-4 w-4"
              style={{ accentColor: LC.accentCyan }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
