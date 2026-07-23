"use client";

import { HoloDirector } from "./HoloDirector";
import { useDirectorRuntime } from "./DirectorRuntime";
import { useTheme } from "@/context/ThemeContext";
import {
  Image,
  Wrench,
  Code,
  Bot,
  Search,
  Brain,
  CheckCircle2,
} from "lucide-react";

const STARTERS = [
  {
    id: "image",
    label: "Generate Image",
    icon: Image,
    prompt: "Generate a hero image for LitLabs",
  },
  {
    id: "build",
    label: "Build Page",
    icon: Wrench,
    prompt: "Build a landing page",
  },
  { id: "code", label: "Fix Code", icon: Code, prompt: "Audit my API routes" },
  {
    id: "agent",
    label: "Create Agent",
    icon: Bot,
    prompt: "Create a new agent",
  },
  {
    id: "search",
    label: "Research",
    icon: Search,
    prompt: "Research best practices for AI agents",
  },
  {
    id: "memory",
    label: "Recall Memory",
    icon: Brain,
    prompt: "What do you remember about my projects?",
  },
];

const STATUS_CONFIG: Record<
  ReturnType<typeof useDirectorRuntime>["state"],
  { label: string; dot: string; border: string; bg: string; text: string }
> = {
  idle: {
    label: "Standby",
    dot: "bg-neutral-500",
    border: "border-neutral-700/50",
    bg: "bg-neutral-800/40",
    text: "text-neutral-400",
  },
  listening: {
    label: "Listening",
    dot: "bg-cyan-400 animate-pulse",
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/10",
    text: "text-cyan-300",
  },
  speaking: {
    label: "Speaking",
    dot: "bg-cyan-400 animate-pulse",
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/10",
    text: "text-cyan-300",
  },
  thinking: {
    label: "Thinking",
    dot: "bg-purple-400 animate-pulse",
    border: "border-purple-500/30",
    bg: "bg-purple-500/10",
    text: "text-purple-300",
  },
  working: {
    label: "Working",
    dot: "bg-amber-400 animate-pulse",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    text: "text-amber-300",
  },
  complete: {
    label: "Complete",
    dot: "bg-green-400",
    border: "border-green-500/30",
    bg: "bg-green-500/10",
    text: "text-green-300",
  },
  error: {
    label: "Error",
    dot: "bg-red-400",
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    text: "text-red-300",
  },
  approval: {
    label: "Approval",
    dot: "bg-orange-400 animate-pulse",
    border: "border-orange-500/30",
    bg: "bg-orange-500/10",
    text: "text-orange-300",
  },
};

export function MissionCanvas() {
  const { state, steps, artifacts, activeArtifact, setActiveArtifact } =
    useDirectorRuntime();
  const { resolvedColors: T } = useTheme();
  const status = STATUS_CONFIG[state];

  const hasStarted = steps.length > 0;

  const handleStarter = (starter: { id: string; prompt: string }) => {
    window.dispatchEvent(
      new CustomEvent("litt-chat-trigger", {
        detail: { text: starter.prompt },
      }),
    );
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-800/60 bg-black/40 backdrop-blur-sm">
      {/* Compact Holo Director header */}
      <div className="relative flex shrink-0 items-center gap-3 p-3 sm:p-4">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: `radial-gradient(circle at left, ${T.accentColor}12 0%, transparent 60%)`,
          }}
        />
        <div className="relative h-14 w-14 sm:h-16 sm:w-16 shrink-0">
          <HoloDirector state={state} className="h-full w-full" />
        </div>
        <div className="relative flex min-w-0 flex-col gap-1">
          <div
            className="text-xs font-black uppercase tracking-[0.2em] sm:text-sm"
            style={{ color: T.headerColor }}
          >
            LiTT
          </div>
          <div
            className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${status.border} ${status.bg} ${status.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </div>
        </div>
      </div>

      {/* Canvas content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
        {!hasStarted ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      handleStarter({ id: s.id, prompt: s.prompt })
                    }
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-800/60 bg-neutral-900/40 px-2.5 py-1.5 text-center transition hover:border-cyan-500/30 hover:bg-cyan-500/5"
                  >
                    <Icon size={13} className="text-cyan-400" />
                    <span className="text-[10px] font-bold text-neutral-300">
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="text-xs font-bold uppercase tracking-widest text-neutral-400 pt-2">
              Recent artifacts
            </div>
            {artifacts.length === 0 ? (
              <div className="text-[10px] text-neutral-400">
                No artifacts yet. Generate something to get started.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {artifacts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setActiveArtifact(a)}
                    aria-label={`View artifact: ${a.title}`}
                    className="relative aspect-square overflow-hidden rounded-xl border border-neutral-800/60"
                  >
                    {a.type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.url}
                        alt={a.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">
                        {a.type}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {steps.slice(-30).map((step) => (
              <div
                key={step.id}
                className={`flex gap-2.5 rounded-lg border border-neutral-800/60 p-2.5 ${
                  step.role === "user" ? "bg-cyan-500/5" : "bg-neutral-900/40"
                }`}
              >
                <div className="mt-0.5">
                  {step.role === "user" ? (
                    <div className="h-5 w-5 rounded-full bg-cyan-500/20" />
                  ) : step.role === "plan" ? (
                    <Brain size={16} className="text-purple-400" />
                  ) : step.role === "tool" ? (
                    <Wrench size={16} className="text-amber-400" />
                  ) : step.role === "result" ? (
                    <CheckCircle2 size={16} className="text-green-400" />
                  ) : (
                    <div className="h-5 w-5 rounded-full bg-cyan-400/20" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-wider text-neutral-400">
                    {step.role}
                  </div>
                  <div className="text-sm text-neutral-200">{step.content}</div>
                </div>
              </div>
            ))}
            {activeArtifact && activeArtifact.type === "image" && (
              <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-400">
                  Generated Artifact
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeArtifact.url}
                  alt={activeArtifact.title}
                  className="w-full rounded-xl object-contain"
                />
                <div className="mt-2 text-xs font-bold text-neutral-300">
                  {activeArtifact.title}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
