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
  Settings2,
  Image as ImageIcon,
  Clapperboard,
  Music2,
  Hammer,
  Bot,
  Terminal as TerminalIcon,
  X,
  Upload,
  Sparkles,
} from "lucide-react";
import CameraSession from "./CameraSession";
import {
  useVoiceSession,
  type VoiceState,
} from "@/app/studio/context/VoiceSessionContext";
import type { StudioTool } from "./StudioSidebar";
import { AGENT_META, type AgentId } from "../stores/useStudioAgentStore";

export type ComposerMode = "text" | "camera";

interface MultimodalComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string, attachments?: string[]) => Promise<string>;
  busy?: boolean;
  modelName?: string;
  onRouteTool?: (tool: StudioTool, command?: string) => void;
  activeAgentId?: AgentId;
}

const COMMANDS: { command: string; description: string; tool: StudioTool }[] = [
  { command: "/terminal", description: "Open Terminal", tool: "terminal" },
  { command: "/run", description: "Run Command", tool: "terminal" },
  { command: "/image", description: "Generate Image", tool: "image" },
  { command: "/video", description: "Generate Video", tool: "video" },
  { command: "/audio", description: "Generate Audio", tool: "audio" },
  { command: "/build", description: "Build Anything", tool: "build" },
  { command: "/code", description: "Generate Code", tool: "code" },
  { command: "/agent", description: "Run Agent", tool: "agents" },
  { command: "/git", description: "Git", tool: "clibridge" },
  { command: "/docker", description: "Docker", tool: "clibridge" },
  { command: "/k8s", description: "Kubernetes", tool: "clibridge" },
  { command: "/aws", description: "AWS", tool: "clibridge" },
  { command: "/supabase", description: "Supabase", tool: "clibridge" },
  { command: "/linear", description: "Linear", tool: "clibridge" },
  { command: "/sentry", description: "Sentry", tool: "clibridge" },
  { command: "/vercel", description: "Vercel", tool: "clibridge" },
];

const STATUS_LABELS: Record<VoiceState, string> = {
  idle: "",
  requesting_permission: "Requesting microphone…",
  connecting: "Connecting…",
  listening: "Listening",
  user_speaking: "You're speaking…",
  processing: "Processing…",
  assistant_speaking: "Agent speaking",
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
  onRouteTool,
  activeAgentId = "litt",
}: MultimodalComposerProps) {
  const agentMeta = AGENT_META[activeAgentId];
  const [mode, setMode] = useState<ComposerMode>("text");
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showMicSetup, setShowMicSetup] = useState(false);
  const [createMode, setCreateMode] = useState<"image" | "video" | null>(null);
  const [createPrompt, setCreatePrompt] = useState("");
  const [createAspect, setCreateAspect] = useState("16:9");
  const [createStyle, setCreateStyle] = useState("Cinematic");
  const [createDuration, setCreateDuration] = useState(4);
  const [createResolution, setCreateResolution] = useState("720p");
  const [createReference, setCreateReference] = useState<string | null>(null);
  const createFileRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sheetTouchYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showAdd) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setShowAdd(false); };
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const previousOverflow = document.documentElement.style.overflow;
    if (mobile) document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (mobile) document.documentElement.style.overflow = previousOverflow;
    };
  }, [showAdd]);

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
    voiceMode,
    selectedDeviceId,
    availableDevices,
    selectDevice,
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
      /\b(generate|create|make|animate|turn).{0,30}\b(video|movie|clip|animation|motion)\b|\bvideo of\b/.test(
        t,
      )
    )
      return "video";
    if (
      /\b(generate|create|make|design).{0,24}\b(image|picture|photo|logo|poster|cover|artwork)\b|\b(draw|image of)\b/.test(
        t,
      )
    )
      return "image";
    if (/\b(generate|create|make|compose).{0,24}\b(audio|music|song|sound|voice|speech)\b/.test(t))
      return "audio";
    if (/\b(build|create|make).{0,24}\b(app|website|site|dashboard|page|product)\b/.test(t))
      return "build";
    if (/\b(write|generate|fix|refactor|debug).{0,24}\b(code|component|function|typescript|javascript|react)\b/.test(t))
      return "code";
    if (/\b(open|use|show).{0,16}\bterminal\b|\brun (this )?command\b/.test(t))
      return "terminal";
    if (/\b(create|launch|run|build).{0,20}\b(agent|assistant|crew)\b/.test(t))
      return "agents";
    if (/\b(show|open|browse|find).{0,20}\b(assets|gallery|files|creations)\b/.test(t))
      return "assets";
    if (
      /\b(build a page|create a mission|new mission|start a project)\b/.test(t)
    )
      return "mission";
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() && snapshots.length === 0) return;
    const trimmed = value.trim();
    if (trimmed.startsWith("$ ") && onRouteTool) {
      onRouteTool("terminal", trimmed.slice(2).trim());
      onChange("");
      return;
    }
    const slashCommand = COMMANDS.find(
      ({ command }) =>
        trimmed.toLowerCase() === command ||
        trimmed.toLowerCase().startsWith(`${command} `),
    );
    if (slashCommand && onRouteTool) {
      if (slashCommand.tool === "image" || slashCommand.tool === "video") {
        setCreateMode(slashCommand.tool);
        setCreatePrompt(trimmed.replace(/^\/(image|video)\s*/i, ""));
        onChange("");
        return;
      }
      onRouteTool(slashCommand.tool, trimmed);
      onChange("");
      return;
    }
    const intent = detectIntent(value);
    if (intent === "camera") {
      setMode("camera");
      onChange("");
      return;
    }
    if (intent === "mission") {
      onRouteTool?.("agents", value);
      onChange("");
      return;
    }
    if (intent) {
      onRouteTool?.(intent as StudioTool, value);
      onChange("");
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
    <div className="relative mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-2 rounded-t-2xl border-x border-t border-white/10 bg-[#060a16]/95 p-2.5 pb-[calc(.625rem+env(safe-area-inset-bottom))] shadow-[0_-18px_60px_rgba(0,0,0,.3)] backdrop-blur-xl sm:pb-2.5">
      {createMode && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-3 backdrop-blur-md" onMouseDown={(event) => event.target === event.currentTarget && setCreateMode(null)}>
          <section role="dialog" aria-modal="true" aria-label={`Generate ${createMode}`} className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/12 bg-[#090a12] shadow-[0_30px_120px_rgba(0,0,0,.8)]">
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-black text-white">{createMode === "image" ? <ImageIcon size={17} className="text-cyan-300" /> : <Clapperboard size={17} className="text-violet-300" />} Generate {createMode === "image" ? "Image" : "Video"}</div>
              <button type="button" onClick={() => setCreateMode(null)} className="rounded-lg p-1.5 text-white/45 hover:bg-white/8 hover:text-white" aria-label="Close"><X size={16} /></button>
            </header>
            <div className="space-y-4 p-4">
              <label className="block text-[9px] font-black uppercase tracking-[.18em] text-white/45">Prompt<textarea autoFocus value={createPrompt} onChange={(e) => setCreatePrompt(e.target.value)} rows={4} placeholder={`Describe the ${createMode} you want to create…`} className="mt-1.5 w-full resize-none rounded-xl border border-white/12 bg-white/5 p-3 text-sm font-normal normal-case tracking-normal text-white outline-none placeholder:text-white/30 focus:border-cyan-300/45" /></label>
              <div><span className="text-[9px] font-black uppercase tracking-[.18em] text-white/45">Aspect ratio</span><div className="mt-1.5 flex flex-wrap gap-2">{["1:1", "16:9", "9:16", "4:3", "3:4"].map((ratio) => <button type="button" key={ratio} onClick={() => setCreateAspect(ratio)} className={`rounded-lg border px-3 py-2 text-[10px] font-bold ${createAspect === ratio ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-200" : "border-white/10 text-white/55 hover:bg-white/5"}`}>{ratio}</button>)}</div></div>
              <div><span className="text-[9px] font-black uppercase tracking-[.18em] text-white/45">Style</span><div className="mt-1.5 flex flex-wrap gap-2">{(createMode === "image" ? ["None", "LiTLabs brand", "Photorealistic", "Anime", "3D render", "Cinematic"] : ["Cinematic", "Product", "Anime motion", "Slow motion", "Music visualizer"]).map((style) => <button type="button" key={style} onClick={() => setCreateStyle(style)} className={`rounded-full border px-3 py-1.5 text-[9px] font-bold ${createStyle === style ? "border-violet-300/55 bg-violet-300/10 text-violet-200" : "border-white/10 text-white/55 hover:bg-white/5"}`}>{style}</button>)}</div></div>
              {createMode === "video" && <div className="grid grid-cols-2 gap-3"><label className="text-[9px] font-black uppercase tracking-wider text-white/45">Duration<select value={createDuration} onChange={(e) => setCreateDuration(Number(e.target.value))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#11131d] p-2 text-xs text-white"><option value={4}>4 seconds</option><option value={6}>6 seconds</option><option value={8}>8 seconds</option></select></label><label className="text-[9px] font-black uppercase tracking-wider text-white/45">Resolution<select value={createResolution} onChange={(e) => setCreateResolution(e.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#11131d] p-2 text-xs text-white"><option>720p</option><option>1080p</option></select></label></div>}
              <button type="button" onClick={() => createFileRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[.025] p-3 text-left text-[10px] text-white/55 hover:border-cyan-300/35"><Upload size={15} className="text-cyan-300" /><span><b className="block text-white/80">{createReference ? "Reference image added" : createMode === "video" ? "Add a starting image" : "Add a reference image"}</b>{createReference ? "Click to replace it" : "Optional · keeps character, composition, or brand direction"}</span></button>
              <input ref={createFileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setCreateReference(String(reader.result)); reader.readAsDataURL(file); }} />
              <button type="button" disabled={createPrompt.trim().length < 3} onClick={() => { sessionStorage.setItem(`litlabs:${createMode}:draft`, JSON.stringify({ prompt: createPrompt.trim(), aspectRatio: createAspect, style: createStyle, duration: createDuration, resolution: createResolution, referenceImage: createReference })); onRouteTool?.(createMode, createPrompt.trim()); setCreateMode(null); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-400 py-3 text-xs font-black text-black disabled:opacity-35"><Sparkles size={14} /> Continue to {createMode === "image" ? "Image" : "Video"} Studio</button>
            </div>
          </section>
        </div>
      )}
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
                  {voiceMode === "recording" && voiceState === "listening"
                    ? "Recording — tap Stop when finished"
                    : STATUS_LABELS[voiceState]}
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

      {showMicSetup && (
        <div className="mb-2 rounded-2xl border border-violet-300/20 bg-[#0b0c16] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <strong className="block text-xs text-white">Microphone setup</strong>
              <span className="text-[9px] text-white/40">
                Chrome uses live voice. Firefox records a turn, then transcribes it.
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
        <button aria-label="Close create menu" className="fixed inset-0 z-[10010] bg-black/60 md:hidden" onClick={() => setShowAdd(false)} />
      )}
      {showAdd && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create and attach"
          onTouchStart={(event) => { sheetTouchYRef.current = event.touches[0]?.clientY ?? null; }}
          onTouchEnd={(event) => { const start = sheetTouchYRef.current; const end = event.changedTouches[0]?.clientY; if (start !== null && end !== undefined && end - start > 70) setShowAdd(false); sheetTouchYRef.current = null; }}
          className="fixed bottom-[calc(8.25rem+env(safe-area-inset-bottom))] left-3 right-3 z-[10020] grid max-h-[min(58dvh,480px)] grid-cols-3 gap-2 overflow-y-auto overscroll-contain rounded-[24px] border border-white/10 bg-[#0a0b12]/98 p-3 shadow-[0_-18px_60px_rgba(0,0,0,.7)] animate-in slide-in-from-bottom-4 sm:static sm:z-auto sm:mb-2 sm:max-h-none sm:grid-cols-5 sm:overflow-visible sm:rounded-2xl sm:p-2"
        >
          <div className="col-span-3 mx-auto mb-1 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
          {[
            { label: "Image", tool: "image" as StudioTool, icon: ImageIcon, color: "text-cyan-300" },
            { label: "Video", tool: "video" as StudioTool, icon: Clapperboard, color: "text-violet-300" },
            { label: "Audio", tool: "audio" as StudioTool, icon: Music2, color: "text-fuchsia-300" },
            { label: "Code", tool: "code" as StudioTool, icon: Hammer, color: "text-orange-300" },
            { label: "Build", tool: "build" as StudioTool, icon: Hammer, color: "text-orange-300" },
            { label: "Agents", tool: "agents" as StudioTool, icon: Bot, color: "text-emerald-300" },
            { label: "Terminal", tool: "terminal" as StudioTool, icon: TerminalIcon, color: "text-emerald-300" },
            { label: "Camera", tool: "camera" as StudioTool, icon: Camera, color: "text-cyan-300" },
            { label: "Screen", tool: "screen" as StudioTool, icon: MonitorUp, color: "text-blue-300" },
            { label: "Plugins", tool: "plugins" as StudioTool, icon: Sparkles, color: "text-violet-300" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.tool === "image" || item.tool === "video") {
                  setCreateMode(item.tool);
                  setCreatePrompt(value.trim());
                } else {
                  onRouteTool?.(item.tool);
                }
                setShowAdd(false);
              }}
              className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-transparent p-2 text-[9px] font-bold text-slate-300 transition hover:border-white/10 hover:bg-white/5 sm:min-h-14"
            >
              <item.icon size={16} className={item.color} /> {item.label}
            </button>
          ))}
          <button
            onClick={() => {
              fileInputRef.current?.click();
              setShowAdd(false);
            }}
            className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-transparent p-2 text-[9px] font-bold text-slate-300 transition hover:border-white/10 hover:bg-white/5 sm:min-h-14"
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
      <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/4 px-2.5 py-2 shadow-[0_12px_45px_rgba(0,0,0,.35)] focus-within:border-cyan-300/30">
        <button
          type="button"
          onClick={() => setShowAdd((value) => !value)}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition ${showAdd ? "rotate-45 border-cyan-300/40 bg-cyan-300/10 text-cyan-200" : "border-white/10 text-white/45 hover:bg-white/8 hover:text-white"}`}
          aria-label={showAdd ? "Close tools" : "Add tool or attachment"}
          title="Tools and attachments"
        >
          <Plus size={16} className="pointer-events-none" />
        </button>
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
          placeholder={agentMeta.placeholder}
          className="flex-1 resize-none bg-transparent text-sm text-white placeholder-white/40 outline-none"
          style={{ minHeight: "44px", maxHeight: "160px" }}
          rows={1}
        />

        <button
          type="button"
          onClick={() => setShowMicSetup((value) => !value)}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${showMicSetup ? "bg-violet-400/12 text-violet-200" : "text-white/35 hover:bg-white/8 hover:text-white"}`}
          aria-label="Microphone setup"
          title="Microphone setup"
        >
          <Settings2 size={15} className="pointer-events-none" />
        </button>

        {/* Mic button */}
        <button
          type="button"
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
            className={`pointer-events-none ${
              voiceState === "requesting_permission" ||
              voiceState === "connecting" ||
              voiceState === "processing"
                ? "animate-spin"
                : ""
            }`}
          />
        </button>

        {/* Send button */}
        <button
          type="button"
          onClick={submit}
          disabled={busy || (!value.trim() && snapshots.length === 0)}
          className="rounded-full p-2 w-9 h-9 flex items-center justify-center transition-all text-white/60 hover:text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send message"
        >
          <Send size={16} className="pointer-events-none" />
        </button>
      </div>

      <div className="flex items-center justify-between px-1 text-[8px] text-white/25">
        <span>Press / for exact commands</span>
        <span className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
          <span className="text-white/40">·</span>
          <span className="font-bold text-white/45">{modelName}</span>
        </span>
      </div>
    </div>
  );
}
