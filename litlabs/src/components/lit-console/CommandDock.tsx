"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Paperclip,
  Wrench,
  Play,
  Mic,
  ChevronUp,
  Bot,
  Cpu,
  Terminal,
  FilePlus,
  Hammer,
  Image,
  Rocket,
  Save,
  X,
} from "lucide-react";
import { LC } from "./lit-console-theme";

interface CommandDockProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onRun?: () => void;
  agent: string;
  model: string;
  onAgentChange: (agent: string) => void;
  onModelChange: (model: string) => void;
  onAttach?: () => void;
  onTools?: () => void;
  onToggleTerminal?: () => void;
  onCreateFile?: () => void;
  onBuild?: () => void;
  onGenerateMedia?: () => void;
  onDeploy?: () => void;
  onSaveWorkflow?: () => void;
}

const AGENTS = [
  { id: "Director", label: "Director", desc: "Orchestrator", color: "#00f5ff" },
  { id: "Code Champ", label: "Code Champ", desc: "Engineer", color: "#22c55e" },
  { id: "Writer", label: "Writer", desc: "Content", color: "#ff9ff3" },
  { id: "Social Dom", label: "Social Dom", desc: "Growth", color: "#ff6b6b" },
  {
    id: "Data Slayer",
    label: "Data Slayer",
    desc: "Analytics",
    color: "#f59e0b",
  },
];

const MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "llama3.2:3b", label: "Llama 3.2 3B" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
];

const TOOLS = [
  { id: "run", label: "Run", icon: Play, onClick: "onRun" },
  {
    id: "terminal",
    label: "Terminal",
    icon: Terminal,
    onClick: "onToggleTerminal",
  },
  { id: "file", label: "Create file", icon: FilePlus, onClick: "onCreateFile" },
  { id: "build", label: "Build", icon: Hammer, onClick: "onBuild" },
  {
    id: "media",
    label: "Generate media",
    icon: Image,
    onClick: "onGenerateMedia",
  },
  { id: "deploy", label: "Deploy", icon: Rocket, onClick: "onDeploy" },
  {
    id: "workflow",
    label: "Save workflow",
    icon: Save,
    onClick: "onSaveWorkflow",
  },
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
      className="absolute bottom-full left-0 mb-2 max-h-60 w-52 overflow-y-auto rounded-lg border py-1 shadow-xl"
      style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export default function CommandDock(props: CommandDockProps) {
  const {
    value,
    onChange,
    onSend,
    onRun,
    agent,
    model,
    onAgentChange,
    onModelChange,
    onAttach,
    onTools,
    onToggleTerminal,
    onCreateFile,
    onBuild,
    onGenerateMedia,
    onDeploy,
    onSaveWorkflow,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

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
    if (id === "run") onRun?.();
    if (id === "terminal") onToggleTerminal?.();
    if (id === "file") onCreateFile?.();
    if (id === "build") onBuild?.();
    if (id === "media") onGenerateMedia?.();
    if (id === "deploy") onDeploy?.();
    if (id === "workflow") onSaveWorkflow?.();
  };

  return (
    <div
      className="w-full border-t px-4 py-3"
      style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
    >
      <div className="mx-auto flex max-w-[1100px] flex-col gap-2">
        {/* Top row: agent/model pickers */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <button
              onClick={() => setAgentOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
            >
              <Bot size={14} style={{ color: LC.accentCyan }} />
              {activeAgent.label}
              <ChevronUp
                size={12}
                style={{
                  color: LC.textDim,
                  transform: agentOpen ? "rotate(180deg)" : undefined,
                }}
              />
            </button>
            <Dropdown open={agentOpen} onClose={() => setAgentOpen(false)}>
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    onAgentChange(a.id);
                    setAgentOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                  style={{ color: a.id === agent ? LC.accentCyan : LC.text }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: a.color }}
                  />
                  <div>
                    <div className="font-semibold">{a.label}</div>
                    <div className="text-[10px]" style={{ color: LC.textDim }}>
                      {a.desc}
                    </div>
                  </div>
                </button>
              ))}
            </Dropdown>
          </div>

          <div className="relative">
            <button
              onClick={() => setModelOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
            >
              <Cpu size={14} style={{ color: LC.accentOrange }} />
              {activeModel.label}
              <ChevronUp
                size={12}
                style={{
                  color: LC.textDim,
                  transform: modelOpen ? "rotate(180deg)" : undefined,
                }}
              />
            </button>
            <Dropdown open={modelOpen} onClose={() => setModelOpen(false)}>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onModelChange(m.id);
                    setModelOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                  style={{ color: m.id === model ? LC.accentCyan : LC.text }}
                >
                  {m.label}
                </button>
              ))}
            </Dropdown>
          </div>

          <div className="flex-1" />

          <div className="relative hidden sm:block">
            <button
              onClick={() => setToolsOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.text, border: `1px solid ${LC.borderSubtle}` }}
            >
              <Wrench size={14} style={{ color: LC.textMuted }} />
              Tools
              <ChevronUp
                size={12}
                style={{
                  color: LC.textDim,
                  transform: toolsOpen ? "rotate(180deg)" : undefined,
                }}
              />
            </button>
            <Dropdown open={toolsOpen} onClose={() => setToolsOpen(false)}>
              {TOOLS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleTool(t.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                    style={{ color: LC.text }}
                  >
                    <Icon size={14} style={{ color: LC.textMuted }} />
                    {t.label}
                  </button>
                );
              })}
            </Dropdown>
          </div>
        </div>

        {/* Input row */}
        <div
          className="flex min-h-[56px] items-end gap-2 rounded-xl border px-3 py-2.5"
          style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask LiT to build, run, edit, search, or deploy..."
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-1 text-sm outline-none"
            style={{ color: LC.text, fontFamily: LC.fontMono }}
            rows={1}
          />
          <div className="flex items-center gap-1">
            <button
              onClick={onAttach}
              className="rounded-md p-1.5 transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
            >
              <Paperclip size={16} />
            </button>
            <button
              onClick={onTools}
              className="rounded-md p-1.5 transition-colors hover:bg-white/5 sm:hidden"
              style={{ color: LC.textMuted }}
            >
              <Wrench size={16} />
            </button>
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
            >
              <Mic size={16} />
            </button>
            {onRun && (
              <button
                onClick={onRun}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors"
                style={{ backgroundColor: LC.accentOrange, color: "#000" }}
              >
                <Play size={14} fill="currentColor" />
                Run
              </button>
            )}
            <button
              onClick={onSend}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{ backgroundColor: LC.accentCyan, color: "#000" }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
