"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Paperclip,
  Wrench,
  Play,
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
  Info,
  ShieldCheck,
  Wand2,
  Split,
  Zap,
} from "lucide-react";
import { LC } from "./lit-console-theme";
import type { LiTTipResult } from "@/lib/lit-tip";

interface CommandDockProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onRun?: () => void;
  litTip?: LiTTipResult | null;
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
    litTip,
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

  return (
    <div
      className="w-full shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-3"
      style={{ backgroundColor: LC.bg }}
    >
      <div className="mx-auto max-w-3xl">
        {/* Input row */}
        <div
          className="flex min-h-[56px] items-end gap-2 rounded-2xl border px-4 py-3"
          style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message LiT..."
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-sm outline-none"
            style={{ color: LC.text }}
            rows={1}
          />
          <div className="flex items-center gap-1">
            <button
              onClick={onAttach}
              className="rounded-lg p-2 transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
              title="Attach"
            >
              <Paperclip size={18} />
            </button>
            <button
              onClick={onTools}
              className="rounded-lg p-2 transition-colors hover:bg-white/5 sm:hidden"
              style={{ color: LC.textMuted }}
              title="Tools"
            >
              <Wrench size={18} />
            </button>
            {onRun && (
              <button
                onClick={onRun}
                className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors"
                style={{ backgroundColor: `${LC.accentOrange}20`, color: LC.accentOrange }}
                title="Run plan"
              >
                <Play size={15} fill="currentColor" />
              </button>
            )}
            <button
              onClick={onSend}
              className="flex items-center justify-center rounded-lg p-2 transition-all"
              style={{ backgroundColor: LC.accentCyan, color: "#000" }}
              title="Send"
            >
              <Send size={18} />
            </button>
          </div>
        </div>

        {/* LiT-Tip panel — real-time prompt coaching */}
        {litTip && value.trim() && (
          <div
            className="mt-2 rounded-xl border px-3 py-2 sm:px-4 sm:py-2.5"
            style={{ backgroundColor: `${LC.bgPanel}80`, borderColor: `${LC.border}60` }}
          >
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: LC.accentCyan }}>
                <Lightbulb size={14} />
                LiT-Tip
              </div>
              <div
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: litTip.score >= 80 ? "#22c55e20" : litTip.score >= 50 ? "#f59e0b20" : "#ef444420",
                  color: litTip.score >= 80 ? "#4ade80" : litTip.score >= 50 ? "#fbbf24" : "#f87171",
                }}
              >
                {litTip.score >= 80 ? <CheckCircle2 size={10} /> : litTip.score >= 50 ? <Info size={10} /> : <AlertTriangle size={10} />}
                Score {litTip.score}
              </div>
              <div
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: litTip.risk === "low" ? "#22c55e20" : litTip.risk === "medium" ? "#f59e0b20" : "#ef444420",
                  color: litTip.risk === "low" ? "#4ade80" : litTip.risk === "medium" ? "#fbbf24" : "#f87171",
                }}
              >
                {litTip.risk} risk
              </div>
              <div className="text-[10px] font-medium" style={{ color: LC.textMuted }}>
                ~{litTip.estimatedCredits.min}-{litTip.estimatedCredits.max} credits
              </div>
              {litTip.cheaperPath && (
                <button
                  onClick={useCheaperModel}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.accentCyan}20`, color: LC.accentCyan }}
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

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {litTip.rewrite && litTip.rewrite !== value && (
                <button
                  onClick={applyRewrite}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.accentCyan}18`, color: LC.accentCyan }}
                >
                  <Wand2 size={11} />
                  Fix prompt
                </button>
              )}
              {!litTip.metadata.hasStopCondition && (
                <button
                  onClick={addStopRule}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.accentOrange}18`, color: LC.accentOrange }}
                >
                  <ShieldCheck size={11} />
                  Add stop rule
                </button>
              )}
              {(litTip.metadata.agentCount > 2 || litTip.metadata.wordCount > 200) && (
                <button
                  onClick={splitTask}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/10"
                  style={{ backgroundColor: `${LC.linkColor}18`, color: LC.linkColor }}
                >
                  <Split size={11} />
                  Split task
                </button>
              )}
              {litTip.recommendedModel && litTip.recommendedModel !== model && (
                <button
                  onClick={useCheaperModel}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/10"
                  style={{ backgroundColor: "#22c55e18", color: "#4ade80" }}
                >
                  <Zap size={11} />
                  Use {litTip.recommendedModel}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Bottom row: subtle agent/model pickers + tools */}
        <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5">
          <div className="relative">
            <button
              onClick={() => setAgentOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeAgent.color }} />
              {activeAgent.label}
              <ChevronUp size={11} style={{ transform: agentOpen ? "rotate(180deg)" : undefined }} />
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
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
            >
              <Cpu size={12} />
              {activeModel.label}
              <ChevronUp size={11} style={{ transform: modelOpen ? "rotate(180deg)" : undefined }} />
            </button>
            <Dropdown open={modelOpen} onClose={() => setModelOpen(false)}>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onModelChange(m.id); setModelOpen(false); }}
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
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
            >
              <Wrench size={12} />
              Tools
              <ChevronUp size={11} style={{ transform: toolsOpen ? "rotate(180deg)" : undefined }} />
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
      </div>
    </div>
  );
}
