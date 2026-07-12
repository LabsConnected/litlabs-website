"use client";

import { HoloDirector } from "./HoloDirector";
import { useDirectorRuntime } from "./DirectorRuntime";
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

export function MissionCanvas({
  onPromptAction,
}: {
  onPromptAction?: (prompt: string) => void;
}) {
  const { state, steps, artifacts, activeArtifact, setActiveArtifact } =
    useDirectorRuntime();

  const hasStarted = steps.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-800/60 bg-black/40 backdrop-blur-sm">
      {/* Holo Director area */}
      <div className="relative flex shrink-0 flex-col items-center justify-center p-6">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-cyan-500/10 via-transparent to-transparent" />
        <HoloDirector state={state} size={180} />
        <div className="mt-3 text-center">
          <div className="text-xs font-black uppercase tracking-widest text-cyan-300">
            LiTT Director
          </div>
          <div className="text-[10px] text-neutral-500 capitalize">
            {state.replace("-", " ")}
          </div>
        </div>
      </div>

      {/* Canvas content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {!hasStarted ? (
          <div className="space-y-4">
            <div className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              Start a mission
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STARTERS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => onPromptAction?.(s.prompt)}
                    className="flex flex-col items-center gap-2 rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-3 text-center transition hover:border-cyan-500/30 hover:bg-cyan-500/5"
                  >
                    <Icon size={18} className="text-cyan-400" />
                    <span className="text-[10px] font-bold text-neutral-300">
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="text-xs font-bold uppercase tracking-widest text-neutral-500 pt-2">
              Recent artifacts
            </div>
            {artifacts.length === 0 ? (
              <div className="text-[10px] text-neutral-500">
                No artifacts yet. Generate something to get started.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {artifacts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setActiveArtifact(a)}
                    className="relative aspect-square overflow-hidden rounded-xl border border-neutral-800/60"
                  >
                    {a.type === "image" ? (
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
          <div className="space-y-3">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`flex gap-3 rounded-xl border border-neutral-800/60 p-3 ${
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
                  <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
                    {step.role}
                  </div>
                  <div className="text-sm text-neutral-200">{step.content}</div>
                </div>
              </div>
            ))}
            {activeArtifact && activeArtifact.type === "image" && (
              <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-500">
                  Generated Artifact
                </div>
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
