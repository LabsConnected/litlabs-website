"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Bot,
  Boxes,
  Camera,
  Code2,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Mic,
  MicOff,
  MonitorUp,
  Music,
  Network,
  Palette,
  Plus,
  Rocket,
  Send,
  Shell,
  Sparkles,
  Square,
  TerminalSquare,
  Wand2,
  X,
} from "lucide-react";
import type { StudioTool } from "./StudioSidebar";

export type DockAction = {
  id: string;
  label: string;
  icon: typeof Sparkles;
  shortcut?: string;
  prompt?: string;
  tool?: StudioTool;
};

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type ToolOption = {
  id: StudioTool;
  label: string;
  description: string;
  command: string;
  group: "Create" | "Build" | "Assets";
  icon: typeof Sparkles;
};

const TOOLS: ToolOption[] = [
  { id: "chat", label: "LiTT Chat", description: "Ask, plan, and direct", command: "/chat", group: "Create", icon: Sparkles },
  { id: "image", label: "Image", description: "Generate and edit", command: "/image", group: "Create", icon: ImageIcon },
  { id: "video", label: "Video", description: "Create motion", command: "/video", group: "Create", icon: Film },
  { id: "audio", label: "Audio", description: "Voice and music", command: "/audio", group: "Create", icon: Music },
  { id: "builder", label: "Build", description: "Build the product", command: "/build", group: "Build", icon: Wand2 },
  { id: "agents", label: "Agents", description: "Delegate work", command: "/agents", group: "Build", icon: Bot },
  { id: "terminal", label: "Terminal", description: "Run and inspect", command: "/terminal", group: "Build", icon: TerminalSquare },
  { id: "pipeline", label: "Pipeline", description: "Automate a flow", command: "/pipeline", group: "Build", icon: Network },
  { id: "clibridge", label: "CLI Bridge", description: "Connect local tools", command: "/cli", group: "Build", icon: Shell },
  { id: "gallery", label: "Assets", description: "Browse project media", command: "/assets", group: "Assets", icon: FolderOpen },
  { id: "color", label: "Color", description: "Palette workspace", command: "/color", group: "Assets", icon: Palette },
  { id: "space", label: "Space", description: "Build 360° worlds", command: "/space", group: "Assets", icon: Rocket },
];

export default function StudioCommandDock({
  prompt,
  onPromptChange,
  onSubmit,
  activeTool,
  onToolChange,
  cameraOn,
  onCameraToggle,
  screenOn,
  onScreenToggle,
  activeAgent,
  onAgentChange,
  onOpenPlugins,
  T,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  activeTool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
  recentActions: { tool: StudioTool; label: string }[];
  onAction: (action: DockAction) => void;
  cameraOn: boolean;
  onCameraToggle: () => void;
  screenOn: boolean;
  onScreenToggle: () => void;
  activeAgent: "auto" | "litt-code" | "little-bit";
  onAgentChange: (agent: "auto" | "litt-code" | "little-bit") => void;
  onOpenPlugins: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const active = TOOLS.find((tool) => tool.id === activeTool) ?? TOOLS[0];
  const slashQuery = prompt.startsWith("/")
    ? prompt.slice(1).split(/\s/)[0].toLowerCase()
    : null;
  const slashResults = useMemo(
    () =>
      slashQuery === null
        ? []
        : TOOLS.filter((tool) =>
            `${tool.label} ${tool.command}`.toLowerCase().includes(slashQuery),
          ).slice(0, 6),
    [slashQuery],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const SpeechRecognitionApi = (
      window as unknown as {
        SpeechRecognition?: new () => SpeechRec;
        webkitSpeechRecognition?: new () => SpeechRec;
      }
    ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec })
        .webkitSpeechRecognition;
    if (!SpeechRecognitionApi) return;
    const recognition = new SpeechRecognitionApi();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        transcript += event.results[index][0].transcript;
      }
      onPromptChange(transcript.trim());
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, [onPromptChange]);

  const chooseTool = (tool: ToolOption) => {
    onToolChange(tool.id);
    if (prompt.startsWith("/")) {
      const remainder = prompt.replace(/^\/\S+\s*/, "");
      onPromptChange(remainder);
    }
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  const toggleVoice = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) recognition.stop();
    else {
      recognition.start();
      setListening(true);
    }
  };

  return (
    <div
      className="relative z-30 shrink-0 border-t px-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] pt-2 sm:px-3"
      style={{
        backgroundColor: `${T.boxBg}e8`,
        borderColor: `${T.borderColor}24`,
        backdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      {(menuOpen || slashResults.length > 0) && (
        <div
          ref={menuRef}
          className="absolute bottom-[calc(100%+.5rem)] left-2 right-2 max-h-[min(520px,62vh)] overflow-y-auto rounded-2xl border p-2 shadow-2xl sm:left-3 sm:right-auto sm:w-[520px]"
          style={{
            background: `linear-gradient(145deg, ${T.boxBg}, ${T.bgColor})`,
            borderColor: `${T.accentColor}45`,
            boxShadow: `0 24px 70px rgba(0,0,0,.65), 0 0 35px ${T.accentColor}14`,
          }}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.22em]" style={{ color: T.accentColor }}>
                {slashResults.length > 0 ? "Slash commands" : "LiTT tools + plugins"}
              </div>
              <div className="mt-0.5 text-[9px]" style={{ color: T.textMuted }}>
                One terminal. Every capability.
              </div>
            </div>
            <button onClick={() => setMenuOpen(false)} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Close tools">
              <X size={14} />
            </button>
          </div>

          {slashResults.length > 0 ? (
            <div className="grid gap-1">
              {slashResults.map((tool) => (
                <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onClick={() => chooseTool(tool)} T={T} />
              ))}
            </div>
          ) : (
            <>
              {(["Create", "Build", "Assets"] as const).map((group) => (
                <section key={group} className="mt-2">
                  <div className="px-2 pb-1 text-[8px] font-black uppercase tracking-[.24em]" style={{ color: T.textMuted }}>
                    {group}
                  </div>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {TOOLS.filter((tool) => tool.group === group).map((tool) => (
                      <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onClick={() => chooseTool(tool)} T={T} />
                    ))}
                  </div>
                </section>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  onClick={onScreenToggle}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-white/5"
                  style={{ borderColor: screenOn ? `${T.success}55` : `${T.borderColor}28`, color: T.textColor }}
                >
                  <MonitorUp size={14} style={{ color: screenOn ? T.success : T.accentColor }} />
                  <span><b className="block text-[10px]">{screenOn ? "Stop screen" : "Share screen"}</b><span className="text-[8px]" style={{ color: T.textMuted }}>Visual workspace context</span></span>
                </button>
                <button
                  onClick={onOpenPlugins}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-white/5"
                  style={{ borderColor: `${T.borderColor}28`, color: T.textColor }}
                >
                  <Boxes size={14} style={{ color: T.accentColor }} />
                  <span><b className="block text-[10px]">Connect plugins</b><span className="text-[8px]" style={{ color: T.textMuted }}>Models, CLI, providers</span></span>
                  <Code2 size={12} className="ml-auto" style={{ color: T.textMuted }} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!prompt.trim() || busy) return;
          setBusy(true);
          onSubmit();
          window.setTimeout(() => setBusy(false), 700);
        }}
        className="mx-auto flex max-w-6xl items-center gap-1.5 rounded-2xl border p-1.5 shadow-lg"
        style={{
          backgroundColor: `${T.bgColor}d8`,
          borderColor: `${T.accentColor}48`,
          boxShadow: `0 0 24px ${T.accentColor}0d`,
        }}
      >
        <button
          type="button"
          onClick={onCameraToggle}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-colors"
          style={{ borderColor: cameraOn ? `${T.success}66` : `${T.borderColor}22`, backgroundColor: cameraOn ? `${T.success}14` : "transparent", color: cameraOn ? T.success : T.textMuted }}
          title={cameraOn ? "Turn LiTT vision off" : "Let LiTT see the workspace"}
        >
          <Camera size={15} />
        </button>
        <button
          type="button"
          onClick={toggleVoice}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-colors"
          style={{ borderColor: listening ? "#fb7185" : `${T.borderColor}22`, color: listening ? "#fb7185" : T.textMuted }}
          title={listening ? "Stop listening" : "Talk to LiTT"}
        >
          {listening ? <MicOff size={15} /> : <Mic size={15} />}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-all hover:scale-105"
          style={{ backgroundColor: menuOpen ? `${T.accentColor}28` : `${T.borderColor}16`, color: T.accentColor }}
          title="Add a tool or plugin"
          aria-label="Open tools and plugins"
        >
          <Plus size={17} className={menuOpen ? "rotate-45 transition-transform" : "transition-transform"} />
        </button>

        <div className="hidden h-7 items-center gap-1.5 rounded-lg border px-2 sm:flex" style={{ borderColor: `${T.borderColor}22`, color: T.accentColor }}>
          <active.icon size={11} />
          <span className="text-[9px] font-black uppercase tracking-wider">{active.label}</span>
        </div>

        <input
          ref={inputRef}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onFocus={() => {
            if (prompt.startsWith("/")) setMenuOpen(false);
          }}
          placeholder="Message LiTT, or type / for every tool…"
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[12px] outline-none placeholder:opacity-45"
          style={{ color: T.textColor }}
        />
        <span className="hidden text-[8px] font-mono opacity-35 lg:inline" style={{ color: T.textMuted }}>⌘K</span>
        <select
          value={activeAgent}
          onChange={(event) => onAgentChange(event.target.value as "auto" | "litt-code" | "little-bit")}
          className="hidden h-9 rounded-xl border bg-transparent px-2 text-[9px] font-bold outline-none md:block"
          style={{ borderColor: `${T.borderColor}25`, color: T.textColor, backgroundColor: T.bgColor }}
          title="Active agent"
        >
          <option value="auto">Auto agent</option>
          <option value="litt-code">LiTT-Code</option>
          <option value="little-bit">LiTTle-Bit</option>
        </select>
        <button
          type="submit"
          disabled={!prompt.trim() || busy}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-all disabled:opacity-35"
          style={{ background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`, color: "white", boxShadow: `0 5px 18px ${T.accentColor}35` }}
          title="Send to LiTT"
        >
          {busy ? <Square size={13} /> : <Send size={16} />}
        </button>
      </form>
      <div className="mx-auto mt-1.5 flex max-w-6xl items-center justify-between px-1 text-[8px] font-mono" style={{ color: T.textMuted }}>
        <span><b style={{ color: T.success }}>● LiTT online</b> · {cameraOn ? "camera on" : "camera private"} · {screenOn ? "screen shared" : "screen private"}</span>
        <span className="hidden sm:inline">/image /build /agents /terminal /plugins</span>
      </div>
    </div>
  );
}

function ToolButton({ tool, active, onClick, T }: { tool: ToolOption; active: boolean; onClick: () => void; T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const Icon = tool.icon;
  return (
    <button
      onClick={onClick}
      className="flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all hover:-translate-y-px"
      style={{ backgroundColor: active ? `${T.accentColor}18` : `${T.bgColor}65`, borderColor: active ? `${T.accentColor}50` : `${T.borderColor}18`, color: T.textColor }}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${T.accentColor}14`, color: T.accentColor }}><Icon size={13} /></span>
      <span className="min-w-0"><b className="block truncate text-[10px]">{tool.label}</b><span className="block truncate text-[8px]" style={{ color: T.textMuted }}>{tool.command} · {tool.description}</span></span>
    </button>
  );
}
