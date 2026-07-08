"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Plus,
  Plug,
  Paperclip,
  Upload,
  Search,
  Film,
  Globe,
  Code2,
  Mic,
  ChevronUp,
  Cpu,
  Terminal,
  FilePlus,
  Hammer,
  Image,
  Rocket,
  Save,
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
  Check,
  Info,
  ShieldCheck,
  Wand2,
  Split,
  Zap,
  MessageSquare,
} from "lucide-react";
import { useLitConsoleTheme } from "./useLitConsoleTheme";
import type { LiTTipResult } from "@/lib/lit-tip";

interface CommandDockProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  litTip?: LiTTipResult | null;
  agent: string;
  model: string;
  onAgentChange: (agent: string) => void;
  onModelChange: (model: string) => void;
  onAttach?: () => void;
  onFileSelect?: (file: File) => void;
  onTools?: () => void;
  onConnectors?: () => void;
  onToggleTerminal?: () => void;
  onCreateFile?: () => void;
  onBuild?: () => void;
  onGenerateMedia?: () => void;
  onDeploy?: () => void;
  onSaveWorkflow?: () => void;
  onVoice?: () => void;
  onVoiceStop?: () => void;
  voiceState?: "idle" | "listening" | "thinking" | "speaking" | "error";
  mode?: ModeId;
  onModeChange?: (mode: ModeId) => void;
  /* Run Execution Loop support */
  onRun?: (text: string) => void;
  isRunning?: boolean;
}

const AGENTS = [
  { id: "director",       label: "LiTTree",       desc: "Core AI Copilot",       color: "#22d3ee" },
  { id: "forge",          label: "Forge",          desc: "Engineer & Architect",   color: "#22d3ee" },
  { id: "pulse",          label: "Pulse",          desc: "Growth & Analytics",     color: "#f472b6" },
  { id: "pixel-forge",    label: "Visionary",      desc: "Creative Director",      color: "#e879f9" },
  { id: "social-pilot",   label: "SocialPilot",    desc: "Social Media Growth",    color: "#a855f7" },
  { id: "data-slayer",    label: "Data Slayer",    desc: "Analytics & Insights",   color: "#fbbf24" },
  { id: "writing-coach",  label: "Writing Coach",  desc: "Content & Copy",         color: "#a78bfa" },
  { id: "music-producer", label: "Music Producer", desc: "Audio & Sound",          color: "#fb7185" },
  { id: "nexus",          label: "Nexus",          desc: "Automation",             color: "#34d399" },
  { id: "security-chief", label: "Security Chief", desc: "Security & Privacy",     color: "#ef4444" },
];

const MODES = [
  { id: "ask", label: "Ask", placeholder: "Ask LiTTree anything...", color: "#94a3b8" },
  { id: "image", label: "Images", placeholder: "Describe the image you want...", color: "#e879f9" },
  { id: "website", label: "Website", placeholder: "Describe the website you want...", color: "#f472b6" },
  { id: "code", label: "Code", placeholder: "Paste code or describe the bug...", color: "#f97316" },
  { id: "audio", label: "Audio", placeholder: "Describe the audio or music you want...", color: "#38bdf8" },
  { id: "video", label: "Video", placeholder: "Describe the video you want...", color: "#a78bfa" },
  { id: "flow", label: "Flow", placeholder: "Describe the workflow or automation...", color: "#4ade80" },
  { id: "research", label: "Research", placeholder: "What do you want to research?", color: "#fbbf24" },
  { id: "terminal", label: "Terminal", placeholder: "Run a command or ask about the terminal...", color: "#94a3b8" },
  { id: "deploy", label: "Deploy", placeholder: "What should I deploy or run?", color: "#22c55e" },
] as const;
type ModeId = typeof MODES[number]["id"];

export const MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "openrouter", model: "google/gemini-2.5-flash", description: "Fast, cheap, great for most tasks" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "openrouter", model: "google/gemini-2.5-pro", description: "Best reasoning and coding" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4", provider: "openrouter", model: "anthropic/claude-sonnet-4", description: "Nuanced writing and analysis" },
  { id: "claude-opus-4", label: "Claude Opus 4", provider: "openrouter", model: "anthropic/claude-opus-4", description: "Most capable Claude" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openrouter", model: "openai/gpt-4o", description: "General purpose, fast" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openrouter", model: "openai/gpt-4.1-mini", description: "Compact, efficient" },
  { id: "llama-4-maverick", label: "Llama 4 Maverick", provider: "openrouter", model: "meta-llama/llama-4-maverick", description: "Open model, strong performance" },
  { id: "deepseek-v3", label: "DeepSeek V3", provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324", description: "Coding and reasoning" },
  { id: "llama3.2:3b", label: "Llama 3.2 3B (local)", provider: "ollama", model: "llama3.2:3b", description: "Runs on your own machine" },
];

const TOOLS = [
  { id: "connectors", label: "Connectors", icon: Plug },
  { id: "attach", label: "Upload attachment", icon: Upload },
  { id: "research", label: "Deep Research", icon: Search },
  { id: "image", label: "Create Image", icon: Image },
  { id: "video", label: "Create Video", icon: Film },
  { id: "website", label: "Web Dev", icon: Globe },
  { id: "code", label: "Code Fixer", icon: Code2 },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "build", label: "Build", icon: Hammer },
  { id: "deploy", label: "Deploy", icon: Rocket },
  { id: "file", label: "Create file", icon: FilePlus },
  { id: "workflow", label: "Save workflow", icon: Save },
];

function Dropdown({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const LC = useLitConsoleTheme();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-50 mb-2 hidden max-h-60 w-56 overflow-y-auto rounded-lg border py-1 shadow-2xl md:block"
      style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export default function CommandDock(props: CommandDockProps) {
  const LC = useLitConsoleTheme();
  const {
    value,
    onChange,
    onSend,
    litTip,
    agent,
    model,
    onAgentChange,
    onModelChange,
    onAttach,
    onFileSelect,
    onConnectors,
    onToggleTerminal,
    onCreateFile,
    onBuild,
    onDeploy,
    onSaveWorkflow,
    onVoice,
    onVoiceStop,
    voiceState,
    mode: modeProp,
    onModeChange,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [internalMode, setInternalMode] = useState<ModeId>("ask");
  const mode = modeProp ?? internalMode;
  const setMode = (next: ModeId) => {
    setInternalMode(next);
    onModeChange?.(next);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const activeAgent = AGENTS.find((a) => a.id === agent) || AGENTS[0];
  const activeModel = MODELS.find((m) => m.id === model) || MODELS[0];

  const handleTool = (id: string) => {
    setToolsOpen(false);
    if (id === "connectors") { onConnectors?.(); return; }
    if (id === "attach") { onAttach?.(); return; }
    if (id === "terminal") { onToggleTerminal?.(); return; }
    if (id === "file") { onCreateFile?.(); return; }
    if (id === "build") { onBuild?.(); return; }
    if (id === "deploy") { onDeploy?.(); return; }
    if (id === "workflow") { onSaveWorkflow?.(); return; }
    // Mode-setting tools switch the prompt context
    const modeMap: Record<string, ModeId> = {
      research: "research",
      image: "image",
      video: "video",
      website: "website",
      code: "code",
    };
    if (modeMap[id]) {
      setMode(modeMap[id]);
      const placeholder = MODES.find((m) => m.id === modeMap[id])?.placeholder || "";
      if (!value.trim()) onChange(placeholder);
    }
  };

  const applyRewrite = () => {
    if (litTip?.rewrite && litTip.rewrite !== value) {
      onChange(litTip.rewrite);
    }
  };

  const addStopRule = () => {
    const rule = "\n\nStop condition: stop after one attempt and ask for approval before continuing.";
    if (!value.includes("Stop condition")) onChange(value.trim() + rule);
  };

  const splitTask = () => {
    const note = "\n\nStep 1: plan the approach. Step 2: implement only the planned part.";
    if (!value.includes("Step 1")) onChange(value.trim() + note);
  };

  const useCheaperModel = () => {
    if (litTip?.recommendedModel) {
      onModelChange(litTip.recommendedModel);
    }
  };

  const listening = voiceState === "listening";

  const [activeMode, setActiveMode] = useState<"text" | "files" | "tools">("text");

  const handleModeClick = (id: typeof activeMode) => {
    setActiveMode(id);
    if (id === "text") textareaRef.current?.focus();
    if (id === "files") fileInputRef.current?.click();
    if (id === "tools") setToolsOpen((v) => !v);
  };

  const modeTabs = [
    { id: "text", label: "Text", icon: MessageSquare },
    { id: "files", label: "Files", icon: Paperclip },
    { id: "tools", label: "Tools", icon: Plus },
  ] as const;

  const toolsMenu = TOOLS.map((t) => {
    const Icon = t.icon;
    return (
      <button
        key={t.id}
        onClick={() => handleTool(t.id)}
        className="flex items-center gap-2 rounded-xl px-3 py-3 text-left text-xs font-bold transition-colors hover:bg-white/5 md:rounded-none md:py-2 md:font-normal"
        style={{ color: LC.text }}
      >
        <Icon size={15} style={{ color: LC.textMuted }} />
        {t.label}
      </button>
    );
  });

  return (
    <div
      className="relative z-30 w-full shrink-0 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-1.5 sm:px-4 sm:pb-3 sm:pt-2"
      style={{ backgroundColor: LC.bg }}
    >
      <div className="relative mx-auto max-w-3xl">
        {/* Composer mode tabs */}
        <div className="mb-1.5 flex items-center gap-1 overflow-x-auto px-0.5 sm:gap-2 sm:px-0">
          {modeTabs.map((m) => {
            const Icon = m.icon;
            const isActive = activeMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleModeClick(m.id)}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-bold transition-all whitespace-nowrap sm:py-1"
                style={{
                  color: isActive ? LC.accentCyan : LC.textDim,
                  backgroundColor: isActive ? `${LC.accentCyan}12` : "transparent",
                  border: `1px solid ${isActive ? LC.accentCyan : LC.borderSubtle}`,
                  boxShadow: isActive ? `0 0 12px ${LC.accentCyan}20` : undefined,
                }}
              >
                <Icon size={12} />
                {m.label}
              </button>
            );
          })}
        </div>

        <div
          className="flex min-h-[52px] items-end gap-1.5 rounded-2xl border px-2 py-2 transition-all sm:min-h-[56px] sm:gap-2 sm:px-3 sm:py-2.5"
          style={{
            backgroundColor: LC.bgPanel,
            borderColor: focused ? LC.accentCyan : LC.borderSubtle,
            boxShadow: focused ? `0 0 0 1px ${LC.accentCyan}40, 0 0 24px ${LC.accentCyan}25, 0 0 48px ${LC.linkColor}15` : undefined,
          }}
        >
          {/* Tools menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setToolsOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full transition-all hover:bg-white/5 sm:h-9 sm:w-9"
              style={{
                color: LC.textMuted,
                backgroundColor: toolsOpen ? `${LC.accentCyan}15` : "transparent",
                border: `1px solid ${toolsOpen ? LC.accentCyan : LC.borderSubtle}`,
              }}
              title="Tools"
            >
              <Plus size={18} style={{ color: toolsOpen ? LC.accentCyan : LC.textMuted }} />
            </button>
            <Dropdown open={toolsOpen} onClose={() => setToolsOpen(false)}>
              {toolsMenu}
            </Dropdown>
          </div>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={MODES.find((m) => m.id === mode)?.placeholder || "Ask LiTTree anything..."}
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-2 text-base outline-none sm:max-h-40 sm:py-1.5 sm:text-sm"
            style={{ color: LC.text }}
            rows={1}
          />
          <div className="flex items-center gap-0.5 shrink-0 sm:gap-1">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && onFileSelect) {
                  onFileSelect(file);
                }
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg p-2 transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
              title="Attach"
            >
              <Paperclip size={18} />
            </button>
            {onVoice && (
              <button
                type="button"
                onClick={listening ? onVoiceStop : onVoice}
                className="relative flex h-10 w-10 items-center justify-center rounded-full transition-all sm:h-9 sm:w-9"
                style={{
                  color: listening ? "#000" : LC.accentCyan,
                  backgroundColor: listening ? LC.accentCyan : "transparent",
                  border: `1px solid ${LC.accentCyan}`,
                }}
                title={listening ? "Stop listening" : "Tap to speak"}
              >
                {listening && (
                  <span
                    className="absolute inset-0 rounded-full animate-ping"
                    style={{ backgroundColor: `${LC.accentCyan}40` }}
                  />
                )}
                <Mic size={18} fill={listening ? "currentColor" : "none"} />
              </button>
            )}
            <button
              onClick={onSend}
              className="flex h-10 w-10 items-center justify-center rounded-full transition-all sm:h-9 sm:w-9"
              style={{ backgroundColor: LC.accentCyan, color: "#000" }}
              title="Send"
            >
              <Send size={18} />
            </button>
          </div>
        </div>

        {/* Active mode hint */}
        <div className="mt-1 flex items-center justify-center gap-1 text-[10px]" style={{ color: LC.textDim }}>
          <span style={{ color: MODES.find((m) => m.id === mode)?.color || LC.textDim }}>
            {MODES.find((m) => m.id === mode)?.label || "Ask"}
          </span>
          <span>·</span>
          <span>Type a prompt or pick a tool from the + menu</span>
        </div>

        {litTip && value.trim() && (
          <div
            className="mt-2 rounded-xl border px-3 py-1.5"
            style={{ backgroundColor: LC.bgPanel, borderColor: LC.borderSubtle }}
          >
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: LC.textMuted }}>
                <Lightbulb size={13} />
                LiT-Tip
              </div>
              <div
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: litTip.score >= 80 ? "#22c55e18" : litTip.score >= 50 ? "#f59e0b18" : "#ef444418",
                  color: litTip.score >= 80 ? "#4ade80" : litTip.score >= 50 ? "#fbbf24" : "#f87171",
                }}
              >
                {litTip.score >= 80 ? <CheckCircle2 size={10} /> : litTip.score >= 50 ? <Info size={10} /> : <AlertTriangle size={10} />}
                Score {litTip.score}
              </div>
              <div
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: litTip.risk === "low" ? "#22c55e18" : litTip.risk === "medium" ? "#f59e0b18" : "#ef444418",
                  color: litTip.risk === "low" ? "#4ade80" : litTip.risk === "medium" ? "#fbbf24" : "#f87171",
                }}
              >
                {litTip.risk} risk
              </div>
              <div className="text-[10px] font-medium" style={{ color: LC.textDim }}>
                ~{litTip.estimatedCredits.min}-{litTip.estimatedCredits.max} credits
              </div>
              {litTip.cheaperPath && (
                <button
                  onClick={useCheaperModel}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.accentCyan}18`, color: LC.accentCyan }}
                >
                  <Zap size={10} />
                  Cheaper route
                </button>
              )}
            </div>

            {litTip.tips.length > 0 && (
              <div className="flex flex-col gap-1">
                {litTip.tips.slice(0, 3).map((tip) => {
                  const Icon = tip.severity === "success" ? CheckCircle2 : tip.severity === "risk" ? AlertTriangle : tip.severity === "warning" ? ShieldCheck : Info;
                  return (
                    <div key={tip.id} className="flex items-start gap-1.5 text-xs" style={{ color: LC.text }}>
                      <Icon size={13} className="mt-0.5 shrink-0" style={{ color: tip.severity === "success" ? "#4ade80" : tip.severity === "risk" ? "#f87171" : tip.severity === "warning" ? "#fbbf24" : "#94a3b8" }} />
                      <span className="leading-snug">{tip.message}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {litTip.rewrite && litTip.rewrite !== value && (
                <button
                  onClick={applyRewrite}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.accentCyan}18`, color: LC.accentCyan }}
                >
                  <Wand2 size={11} />
                  Fix prompt
                </button>
              )}
              {!litTip.metadata.hasStopCondition && (
                <button
                  onClick={addStopRule}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.accentOrange}18`, color: LC.accentOrange }}
                >
                  <ShieldCheck size={11} />
                  Add stop rule
                </button>
              )}
              {(litTip.metadata.agentCount > 2 || litTip.metadata.wordCount > 200) && (
                <button
                  onClick={splitTask}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.linkColor}18`, color: LC.linkColor }}
                >
                  <Split size={11} />
                  Split task
                </button>
              )}
              {litTip.recommendedModel && litTip.recommendedModel !== model && (
                <button
                  onClick={useCheaperModel}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors hover:bg-white/10"
                  style={{ backgroundColor: "#22c55e18", color: "#4ade80" }}
                >
                  <Zap size={11} />
                  Use {litTip.recommendedModel}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
          <div className="relative">
            <button
              onClick={() => setAgentOpen((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.textDim }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: activeAgent.color }} />
              <span style={{ color: LC.textMuted }}>{activeAgent.label}</span>
              <ChevronUp size={10} style={{ transform: agentOpen ? "rotate(180deg)" : undefined }} />
            </button>
            <Dropdown open={agentOpen} onClose={() => setAgentOpen(false)}>
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { onAgentChange(a.id); setAgentOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                  style={{ color: a.id === agent ? LC.accentCyan : LC.text }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
                  <div>
                    <div className="font-semibold">{a.label}</div>
                    <div className="text-[10px]" style={{ color: LC.textDim }}>{a.desc}</div>
                  </div>
                </button>
              ))}
            </Dropdown>
          </div>

          <div className="relative">
            <button
              onClick={() => setModelOpen((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.textDim }}
            >
              <Cpu size={11} />
              <span style={{ color: LC.textMuted }}>{activeModel.label}</span>
              <ChevronUp size={10} style={{ transform: modelOpen ? "rotate(180deg)" : undefined }} />
            </button>
            <Dropdown open={modelOpen} onClose={() => setModelOpen(false)}>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onModelChange(m.id); setModelOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                  style={{ color: m.id === model ? LC.accentCyan : LC.text }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{m.label}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: `${LC.bgSecondary}`, color: LC.textDim }}>
                        {m.provider}
                      </span>
                    </div>
                    <div className="text-[10px] truncate" style={{ color: LC.textDim }}>{m.description}</div>
                  </div>
                  {m.id === model && <Check size={12} style={{ color: LC.accentCyan }} />}
                </button>
              ))}
            </Dropdown>
          </div>

        </div>
      </div>

      {toolsOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close tools"
            className="absolute inset-0 w-full bg-black/60"
            onClick={() => setToolsOpen(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"
            style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ backgroundColor: LC.border }} />
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: LC.textMuted }}>
                Tools
              </div>
              <button
                type="button"
                onClick={() => setToolsOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold"
                style={{ color: LC.accentCyan, backgroundColor: `${LC.accentCyan}12` }}
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {toolsMenu}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
