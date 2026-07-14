"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  Mic,
  MicOff,
  MonitorUp,
  Paperclip,
  Plus,
  Send,
  Square,
  Loader2,
} from "lucide-react";
import CameraSession from "./CameraSession";
import {
  useVoiceSession,
  type VoiceState,
} from "@/app/studio/context/VoiceSessionContext";

export type ComposerMode = "text" | "camera";

interface MultimodalComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string, attachments?: string[]) => Promise<string>;
  busy?: boolean;
  modelName?: string;
}

const STATUS_LABELS: Record<VoiceState, string> = {
  idle: "",
  requesting_permission: "Requesting microphone…",
  connecting: "Connecting…",
  listening: "Listening",
  user_speaking: "You're speaking…",
  processing: "Processing…",
  assistant_speaking: "LiTT speaking",
  muted: "Muted",
  error: "",
};

function WaveformBars({ level, active }: { level: number; active: boolean }) {
  const bars = [0.4, 0.7, 1.0, 0.7, 0.4];
  return (
    <div className="flex items-center gap-[2px] h-4">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full transition-all duration-75"
          style={{
            height: active
              ? `${Math.max(20, (h * level + 0.1) * 100)}%`
              : "30%",
            backgroundColor: active
              ? `rgba(34,211,238,${0.5 + h * 0.5})`
              : "rgba(255,255,255,0.2)",
          }}
        />
      ))}
    </div>
  );
}

export default function MultimodalComposer({
  value,
  onChange,
  onSend,
  busy,
  modelName = "Gemini 2.5 Flash",
}: MultimodalComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("text");
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    voiceState,
    micLevel,
    isMuted,
    startVoice,
    stopVoice,
    toggleMute,
    interrupt,
    setOnTurn,
    errorMessage,
  } = useVoiceSession();

  // Set turn handler for voice sessions
  useEffect(() => {
    setOnTurn((text) => {
      void onSend(text);
    });
  }, [onSend, setOnTurn]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [value]);

  const detectIntent = (text: string) => {
    const t = text.toLowerCase();
    if (
      /\b(look at me|what do you see|can you see me|show me|camera on|use camera)\b/.test(
        t,
      )
    )
      return "camera";
    if (
      /\b(generate an image|create an image|make an image|draw|image of)\b/.test(
        t,
      )
    )
      return "image";
    if (
      /\b(build a page|create a mission|new mission|start a project)\b/.test(t)
    )
      return "mission";
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() && snapshots.length === 0) return;
    const intent = detectIntent(value);
    if (intent === "camera") {
      setMode("camera");
      onChange("");
      return;
    }
    if (intent === "image") {
      window.location.href = "/studio/image";
      return;
    }
    if (intent === "mission") {
      window.location.href = "/studio?tool=agents";
      return;
    }
    await onSend(value, snapshots.length ? snapshots : undefined);
    onChange("");
    setSnapshots([]);
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setSnapshots((prev) => [...prev, dataUrl]);
    };
    reader.readAsDataURL(file);
  };

  // Mic button state and click handler
  const getMicButtonState = () => {
    switch (voiceState) {
      case "idle":
        return {
          icon: Mic,
          color: "text-white/40",
          disabled: false,
          onClick: startVoice,
        };
      case "requesting_permission":
        return {
          icon: Loader2,
          color: "text-white/60",
          disabled: true,
          onClick: undefined,
        };
      case "connecting":
        return {
          icon: Loader2,
          color: "text-white/60",
          disabled: true,
          onClick: undefined,
        };
      case "listening":
        return {
          icon: Mic,
          color: "text-cyan-400",
          disabled: false,
          onClick: stopVoice,
        };
      case "user_speaking":
        return {
          icon: Mic,
          color: "text-cyan-400",
          disabled: false,
          onClick: stopVoice,
        };
      case "processing":
        return {
          icon: Loader2,
          color: "text-cyan-400",
          disabled: true,
          onClick: undefined,
        };
      case "assistant_speaking":
        return {
          icon: Square,
          color: "text-amber-400",
          disabled: false,
          onClick: interrupt,
        };
      case "muted":
        return {
          icon: MicOff,
          color: "text-amber-400",
          disabled: false,
          onClick: toggleMute,
        };
      case "error":
        return {
          icon: MicOff,
          color: "text-red-400",
          disabled: false,
          onClick: startVoice,
        };
      default:
        return {
          icon: Mic,
          color: "text-white/40",
          disabled: false,
          onClick: startVoice,
        };
    }
  };

  const micButtonState = getMicButtonState();
  const MicIcon = micButtonState.icon;

  // Mic button styling with pulse effect for listening/speaking states
  const getMicButtonStyle = () => {
    if (voiceState === "listening" || voiceState === "user_speaking") {
      return {
        boxShadow: `0 0 0 ${2 + micLevel * 8}px rgba(34,211,238,${0.2 + micLevel * 0.4})`,
      };
    }
    return {};
  };

  return (
    <div className="relative flex min-w-0 flex-col gap-2 border-t border-white/10 bg-[#060a16]/95 p-2.5">
      {/* Mode panels */}
      {mode === "camera" && (
        <div className="mb-2">
          <CameraSession
            onSnapshot={(url) => {
              setSnapshots((prev) => [...prev, url]);
              void onSend("Describe what you see.", [url]);
              setMode("text");
            }}
            onClose={() => setMode("text")}
            modelName={modelName}
          />
        </div>
      )}

      {/* Voice status strip */}
      {!["idle"].includes(voiceState) && (
        <div
          className={`flex items-center justify-between gap-3 rounded-t-xl border-x border-t px-3 py-1.5 backdrop-blur-md ${
            voiceState === "error"
              ? "border-red-500/20 bg-red-500/5"
              : "border-white/10 bg-black/40"
          }`}
        >
          {/* Left: waveform bars + status text */}
          <div className="flex items-center gap-2">
            {voiceState !== "error" ? (
              <>
                <WaveformBars
                  level={micLevel}
                  active={
                    voiceState === "user_speaking" || voiceState === "listening"
                  }
                />
                <span className="text-[11px] font-bold text-white/80">
                  {STATUS_LABELS[voiceState]}
                </span>
              </>
            ) : (
              <span className="text-[11px] font-bold text-red-400">
                {errorMessage || "Voice session error"}
              </span>
            )}
          </div>
          {/* Right: controls */}
          <div className="flex items-center gap-1.5">
            {voiceState === "assistant_speaking" && (
              <button
                onClick={interrupt}
                className="rounded-full border border-amber-400/40 px-2.5 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-400/10"
              >
                Interrupt
              </button>
            )}
            {voiceState !== "error" ? (
              <>
                <button
                  onClick={toggleMute}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold text-white/60 hover:bg-white/5"
                >
                  {isMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  onClick={stopVoice}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold text-white/60 hover:bg-white/5"
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={stopVoice}
                className="rounded-full border border-red-500/30 px-2.5 py-1 text-[10px] font-bold text-red-400 hover:bg-red-500/10"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* Snapshots */}
      {snapshots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {snapshots.map((src, i) => (
            <div
              key={i}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="snapshot"
                className="h-full w-full object-cover"
              />
              <button
                onClick={() =>
                  setSnapshots((prev) => prev.filter((_, idx) => idx !== i))
                }
                className="absolute right-0 top-0 rounded-bl-lg bg-black/70 p-0.5 text-white"
                aria-label="Remove snapshot"
              >
                <Plus size={10} className="rotate-45" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="scrollbar-hide mb-1 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-1">
        <button
          onClick={() => setShowAdd((v) => !v)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${showAdd ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-slate-400 hover:text-cyan-300"}`}
        >
          <Plus size={12} /> Add
        </button>
        <button
          onClick={() => setMode(mode === "camera" ? "text" : "camera")}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${mode === "camera" ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-slate-400 hover:text-cyan-300"}`}
        >
          <Camera size={12} /> Camera
        </button>
        <button
          onClick={() => {
            setShowAdd(false);
            console.debug("Screen share coming soon");
          }}
          disabled
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 cursor-not-allowed"
        >
          <MonitorUp size={12} /> Screen
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-cyan-300"
        >
          <Paperclip size={12} /> Files
        </button>
      </div>

      {/* Add sheet */}
      {showAdd && (
        <div className="mb-2 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/3 p-2">
          <button
            onClick={() => {
              setMode("camera");
              setShowAdd(false);
            }}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-300 hover:bg-white/5"
          >
            <Camera size={16} className="text-cyan-300" /> Camera
          </button>
          <button
            onClick={() => {
              setShowAdd(false);
              console.debug("Screen share coming soon");
            }}
            disabled
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-600 cursor-not-allowed"
          >
            <MonitorUp size={16} className="text-slate-600" /> Screen
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-300 hover:bg-white/5"
          >
            <Paperclip size={16} className="text-cyan-300" /> Files
          </button>
        </div>
      )}

      <input
        id="composer-file-input"
        name="composer-file-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {/* Input row */}
      <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/4 px-3 py-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
          placeholder="Message LiTT..."
          className="flex-1 resize-none bg-transparent text-sm text-white placeholder-white/40 outline-none"
          style={{ minHeight: "44px", maxHeight: "160px" }}
          rows={1}
        />

        {/* Mic button */}
        <button
          onClick={micButtonState.onClick}
          disabled={micButtonState.disabled}
          className={`rounded-full p-2 w-9 h-9 flex items-center justify-center transition-all ${micButtonState.color} ${
            !micButtonState.disabled && "hover:bg-white/10"
          } ${micButtonState.disabled && "cursor-not-allowed"}`}
          style={getMicButtonStyle()}
          aria-label={voiceState === "idle" ? "Start voice" : "Stop voice"}
        >
          <MicIcon
            size={16}
            className={
              voiceState === "requesting_permission" ||
              voiceState === "connecting" ||
              voiceState === "processing"
                ? "animate-spin"
                : ""
            }
          />
        </button>

        {/* Send button */}
        <button
          onClick={submit}
          disabled={busy || (!value.trim() && snapshots.length === 0)}
          className="rounded-full p-2 w-9 h-9 flex items-center justify-center transition-all text-white/60 hover:text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
