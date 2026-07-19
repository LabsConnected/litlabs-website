"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Loader2,
  Settings2,
} from "lucide-react";
import CameraSession from "./CameraSession";
import {
  useVoiceSession,
  type VoiceState,
} from "@/app/studio/context/VoiceSessionContext";
import { useTheme } from "@/context/ThemeContext";

export type ComposerMode = "text" | "camera";

interface MultimodalComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string, attachments?: string[]) => Promise<string>;
  busy?: boolean;
  modelName?: string;
  onToolChange?: (tool: string) => void;
}

const SLASH_CHIPS = [
  { label: "/image", tool: "image" },
  { label: "/video", tool: "video" },
  { label: "/audio", tool: "audio" },
  { label: "/build", tool: "builder" },
  { label: "/code", tool: "canvas" },
  { label: "/agent", tool: "agents" },
] as const;

// @voice-statuses
const STATUS_LABELS: Record<VoiceState, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  transcribing: "Transcribing…",
  thinking: "LiTT is thinking…",
  speaking: "LiTT is speaking…",
  cooldown: "Voice temporarily unavailable",
  error: "Voice error",
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
  onToolChange,
}: MultimodalComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("text");
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showMicSetup, setShowMicSetup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    voiceState,
    micLevel,
    cooldownRemaining,
    startVoice,
    stopVoice,
    interrupt,
    speakText,
    setOnTurn,
    errorMessage,
    selectedDeviceId,
    availableDevices,
    selectDevice,
  } = useVoiceSession();
  const { resolvedColors: T } = useTheme();

  // Set turn handler for voice sessions — transcribed speech is sent to the
  // model and the reply is spoken back so the voice loop is bidirectional.
  useEffect(() => {
    setOnTurn((text) => {
      if (!text) return;
      void onSend(text).then((reply) => {
        if (reply) speakText(reply);
      });
    });
    return () => setOnTurn(() => {});
  }, [onSend, setOnTurn, speakText]);

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
      /\b(generate an image|create an image|make an image|draw|image of|picture of|photo of|logo for|design a)\b/.test(
        t,
      )
    )
      return "image";
    if (
      /\b(create a video|make a video|generate a video|animate|animation|video of|motion|bring.*to life)\b/.test(
        t,
      )
    )
      return "video";
    if (
      /\b(generate audio|make music|create music|text to speech|read aloud|voice over|narrate|song)\b/.test(
        t,
      )
    )
      return "audio";
    if (
      /\b(build a page|create a mission|new mission|start a project|build a website|make a website|create a website|build an app|make an app)\b/.test(
        t,
      )
    )
      return "mission";
    if (
      /\b(write code|generate code|code snippet|function that|class that|component that|refactor)\b/.test(
        t,
      )
    )
      return "code";
    if (
      /\b(launch an agent|run an agent|start an agent|delegate to|agent to)\b/.test(
        t,
      )
    )
      return "agents";
    if (
      /\b(run a command|terminal|execute|shell command|run this)\b/.test(t)
    )
      return "terminal";
    if (
      /\b(gallery|assets|my images|my videos|my creations)\b/.test(t)
    )
      return "gallery";
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
      onToolChange?.("image");
      return;
    }
    if (intent === "video") {
      onToolChange?.("video");
      return;
    }
    if (intent === "audio") {
      onToolChange?.("audio");
      return;
    }
    if (intent === "mission") {
      onToolChange?.("builder");
      return;
    }
    if (intent === "code") {
      onToolChange?.("canvas");
      return;
    }
    if (intent === "agents") {
      onToolChange?.("agents");
      return;
    }
    if (intent === "terminal") {
      onToolChange?.("terminal");
      return;
    }
    if (intent === "gallery") {
      onToolChange?.("gallery");
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
          color: T.textMuted,
          disabled: false,
          onClick: startVoice,
        };
      case "listening":
        return {
          icon: Mic,
          color: T.accentColor,
          disabled: false,
          onClick: stopVoice,
        };
      case "transcribing":
      case "thinking":
      case "speaking":
      case "cooldown":
        return {
          icon: Loader2,
          color: T.accentColor,
          disabled: true,
          onClick: undefined,
        };
      case "error":
        return {
          icon: MicOff,
          color: "#fb7185",
          disabled: false,
          onClick: startVoice,
        };
      default:
        return {
          icon: Mic,
          color: T.textMuted,
          disabled: false,
          onClick: startVoice,
        };
    }
  };

  const micButtonState = getMicButtonState();
  const MicIcon = micButtonState.icon;

  // Mic button styling with pulse effect for listening/speaking states
  const getMicButtonStyle = () => {
    if (voiceState === "listening") {
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
      {voiceState !== "idle" && (
        <div
          className={`flex items-center justify-between gap-3 rounded-t-xl border-x border-t px-3 py-1.5 backdrop-blur-md ${
            voiceState === "error" || voiceState === "cooldown"
              ? "border-red-500/20 bg-red-500/5"
              : "border-white/10 bg-black/40"
          }`}
        >
          {/* Left: waveform bars + status text */}
          <div className="flex items-center gap-2">
            {voiceState === "error" ? (
              <span className="text-[11px] font-bold text-red-400">
                {errorMessage || "Voice session error"}
              </span>
            ) : voiceState === "cooldown" ? (
              <span className="text-[11px] font-bold text-amber-400">
                Voice limit reached. Retry available in {cooldownRemaining}s
              </span>
            ) : (
              <>
                <WaveformBars
                  level={micLevel}
                  active={voiceState === "listening"}
                />
                <span className="text-[11px] font-bold text-white">
                  {STATUS_LABELS[voiceState]}
                </span>
              </>
            )}
          </div>
          {/* Right: controls */}
          <div className="flex items-center gap-1.5">
            {voiceState === "speaking" && (
              <button
                onClick={interrupt}
                className="rounded-full border border-amber-400/40 px-2.5 py-1 text-[10px] font-bold text-amber-400 hover:bg-amber-400/10"
              >
                Interrupt
              </button>
            )}
            {voiceState === "cooldown" ? (
              <>
                <button
                  onClick={() => {
                    stopVoice();
                    void startVoice();
                  }}
                  className="rounded-full border border-amber-400/40 px-2.5 py-1 text-[10px] font-bold text-amber-400 hover:bg-amber-400/10"
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    stopVoice();
                    textareaRef.current?.focus();
                  }}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold hover:bg-white/5"
                  style={{ color: T.textMuted }}
                >
                  Use text instead
                </button>
              </>
            ) : voiceState === "error" ? (
              <button
                onClick={stopVoice}
                className="rounded-full border border-red-500/30 px-2.5 py-1 text-[10px] font-bold text-red-400 hover:bg-red-500/10"
              >
                Dismiss
              </button>
            ) : (
              <button
                onClick={stopVoice}
                className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold hover:bg-white/5"
                style={{ color: T.textMuted }}
              >
                Stop
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
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${showAdd ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-gray-300 hover:text-cyan-300"}`}
        >
          <Plus size={12} /> Add
        </button>
        <button
          onClick={() => setMode(mode === "camera" ? "text" : "camera")}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${mode === "camera" ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-gray-300 hover:text-cyan-300"}`}
        >
          <Camera size={12} /> Camera
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-gray-300 hover:text-cyan-300"
        >
          <Paperclip size={12} /> Files
        </button>
        <button
          onClick={() => setShowMicSetup((v) => !v)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${showMicSetup ? "border-violet-400/60 bg-violet-400/10 text-violet-200" : "border-white/10 text-gray-300 hover:text-violet-200"}`}
        >
          <Settings2 size={12} /> Mic setup
        </button>
      </div>

      {/* Mic setup panel */}
      {showMicSetup && (
        <div className="mb-2 rounded-2xl border border-violet-300/20 bg-[#0b0c16] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <strong className="block text-xs text-white">Microphone setup</strong>
              <span className="text-[9px] text-white/40">
                Select your input device. Click the mic button to start recording.
              </span>
            </div>
            <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-wider ${voiceState === "error" ? "bg-red-400/10 text-red-300" : availableDevices.length ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>
              {voiceState === "error" ? "Needs attention" : availableDevices.length ? "Mic detected" : "Permission needed"}
            </span>
          </div>
          <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-white/35" htmlFor="studio-mic-device">
            Input device
          </label>
          <select
            id="studio-mic-device"
            value={selectedDeviceId || ""}
            onChange={(event) => selectDevice(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-violet-300/50"
          >
            <option value="">System default microphone</option>
            {availableDevices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[9px] leading-4 text-white/40">
            If no device appears, click the mic once and choose Allow. In Firefox, use the microphone icon beside the address bar to reset a blocked permission.
          </p>
        </div>
      )}

      {/* Add sheet */}
      {showAdd && (
        <div className="mb-2 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/3 p-2">
          <button
            onClick={() => {
              setMode("camera");
              setShowAdd(false);
            }}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-gray-200 hover:bg-white/5"
          >
            <Camera size={16} className="text-cyan-400" /> Camera
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-gray-200 hover:bg-white/5"
          >
            <Paperclip size={16} className="text-cyan-400" /> Files
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
          name="litt-composer-message"
          id="litt-composer-message"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
          placeholder="Message LiTT..."
          className="flex-1 resize-none bg-transparent text-sm text-white placeholder:text-neutral-400 outline-none"
          style={{ minHeight: "44px", maxHeight: "160px" }}
          rows={1}
        />

        {/* Mic button */}
        <button
          onClick={micButtonState.onClick}
          disabled={micButtonState.disabled}
          className={`rounded-full p-2 w-9 h-9 flex items-center justify-center transition-all ${
            !micButtonState.disabled && "hover:bg-white/10"
          } ${micButtonState.disabled && "cursor-not-allowed"}`}
          style={{ ...getMicButtonStyle(), color: micButtonState.color }}
          aria-label={voiceState === "idle" ? "Start voice" : "Stop voice"}
        >
          <MicIcon
            size={16}
            className={
              voiceState === "transcribing" || voiceState === "thinking"
                ? "animate-spin"
                : ""
            }
          />
        </button>

        {/* Send button */}
        <button
          onClick={submit}
          disabled={busy || (!value.trim() && snapshots.length === 0)}
          className="rounded-full p-2 w-9 h-9 flex items-center justify-center transition-all text-gray-300 hover:text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>

      {/* Tool shortcut chips */}
      <div className="scrollbar-hide flex items-center gap-1.5 overflow-x-auto pb-1">
        {SLASH_CHIPS.map((chip) => (
          <button
            key={chip.tool}
            onClick={() => onToolChange?.(chip.tool)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-gray-200 transition hover:border-cyan-400/30 hover:text-cyan-300"
            aria-label={`Switch to ${chip.tool} tool`}
          >
            <span className="text-cyan-400">{chip.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
