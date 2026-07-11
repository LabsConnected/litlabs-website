"use client";

import { useState } from "react";
import {
  Brain,
  AlertTriangle,
  CheckCircle2,
  Image,
  FileCode,
  Globe,
  Server,
  Zap,
} from "lucide-react";

type AgentState = {
  name: string;
  role: string;
  color: string;
  status:
    | "thinking"
    | "coding"
    | "designing"
    | "searching"
    | "testing"
    | "idle";
  progress: number;
  model: string;
  tools: string[];
  currentTask?: string;
};

const AGENTS: AgentState[] = [
  {
    name: "Director",
    role: "Orchestrator",
    color: "#22d3ee",
    status: "thinking",
    progress: 82,
    model: "GPT-5.5",
    tools: ["Plan", "Route", "Summarize"],
    currentTask: "Planning architecture",
  },
  {
    name: "Forge",
    role: "Engineer",
    color: "#fb923c",
    status: "coding",
    progress: 64,
    model: "Claude 4",
    tools: ["Code", "GitHub", "Terminal", "Deploy"],
    currentTask: "Writing API routes",
  },
  {
    name: "Visionary",
    role: "Creative",
    color: "#e879f9",
    status: "designing",
    progress: 0,
    model: "FLUX",
    tools: ["Image", "Video", "UI", "Brand"],
    currentTask: "Awaiting brief",
  },
  {
    name: "Research",
    role: "Knowledge",
    color: "#60a5fa",
    status: "searching",
    progress: 0,
    model: "Perplexity",
    tools: ["Web", "Knowledge", "Sources"],
    currentTask: "Gathering sources",
  },
  {
    name: "QA",
    role: "Tester",
    color: "#f87171",
    status: "testing",
    progress: 0,
    model: "Playwright",
    tools: ["Tests", "Logs", "Coverage"],
    currentTask: "Queued",
  },
  {
    name: "Memory",
    role: "Recall",
    color: "#34d399",
    status: "idle",
    progress: 95,
    model: "Embeddings",
    tools: ["Store", "Retrieve", "Rank"],
    currentTask: "Syncing context",
  },
];

const TOOLS: {
  name: string;
  icon: React.ElementType;
  state: "connected" | "running" | "idle";
}[] = [
  { name: "GitHub", icon: FileCode, state: "connected" },
  { name: "Supabase", icon: Server, state: "connected" },
  { name: "Stripe", icon: CheckCircle2, state: "connected" },
  { name: "OpenRouter", icon: Zap, state: "running" },
  { name: "Figma", icon: Image, state: "idle" },
  { name: "Browser", icon: Globe, state: "connected" },
];

const NEEDS_ATTENTION = [
  { issue: "Stripe webhook missing secret", severity: "medium" },
  { issue: "Database migration pending", severity: "low" },
];

const BRAIN_STREAM = [
  { agent: "Director", action: "→ Planner", time: "09:31" },
  { agent: "Forge", action: "→ GitHub", time: "09:32" },
  { agent: "Build", action: "Success", time: "09:36" },
  { agent: "QA", action: "→ Deploy", time: "09:38" },
];

export function AIIntelligencePanel() {
  const [selected, setSelected] = useState<string | null>("Director");

  return (
    <div className="flex h-full flex-col gap-4 border-l border-neutral-800/60 bg-[#060606] p-3 text-neutral-200">
      <div className="flex items-center gap-2">
        <Brain size={16} className="text-fuchsia-400" />
        <span className="text-xs font-black uppercase tracking-widest text-fuchsia-300">
          AI Intelligence
        </span>
      </div>

      {/* Agent swarm */}
      <div className="space-y-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500">
          Agent Swarm
        </div>
        <div className="grid grid-cols-2 gap-2">
          {AGENTS.map((agent) => (
            <button
              key={agent.name}
              onClick={() =>
                setSelected(selected === agent.name ? null : agent.name)
              }
              className={`rounded-xl border p-2.5 text-left transition-all hover:scale-[1.02] ${
                selected === agent.name
                  ? "border-cyan-500/40 bg-cyan-500/10"
                  : "border-neutral-800/60 bg-neutral-900/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: agent.color,
                    boxShadow: `0 0 8px ${agent.color}`,
                  }}
                />
                <span className="text-[10px] font-bold">{agent.name}</span>
              </div>
              <div className="text-[9px] text-neutral-400 capitalize">
                {agent.status}
              </div>
              {agent.progress > 0 ? (
                <div className="mt-1.5 h-1 w-full rounded-full bg-neutral-800">
                  <div
                    className="h-1 rounded-full transition-all"
                    style={{
                      width: `${agent.progress}%`,
                      backgroundColor: agent.color,
                    }}
                  />
                </div>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <AgentDetail agent={AGENTS.find((a) => a.name === selected)!} />
      )}

      {/* Active tools */}
      <div className="space-y-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500">
          Active Tools
        </div>
        <div className="space-y-1.5">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <div
                key={tool.name}
                className="flex items-center justify-between rounded-lg border border-neutral-800/40 bg-neutral-900/30 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <Icon size={12} className="text-neutral-400" />
                  <span className="text-[10px] font-semibold">{tool.name}</span>
                </div>
                <span
                  className={`text-[9px] font-black uppercase ${
                    tool.state === "connected"
                      ? "text-green-400"
                      : tool.state === "running"
                        ? "text-cyan-400"
                        : "text-neutral-500"
                  }`}
                >
                  {tool.state}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Brain stream */}
      <div className="space-y-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500">
          Brain Stream
        </div>
        <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-2.5 space-y-2">
          {BRAIN_STREAM.map((event, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-[10px]"
            >
              <span className="font-semibold text-cyan-300">{event.agent}</span>
              <span className="text-neutral-400">{event.action}</span>
              <span className="text-neutral-600">{event.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Needs attention */}
      <div className="space-y-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-amber-500/80">
          Needs Attention
        </div>
        <div className="space-y-1.5">
          {NEEDS_ATTENTION.map((item) => (
            <div
              key={item.issue}
              className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5"
            >
              <AlertTriangle
                size={12}
                className="mt-0.5 text-amber-400 shrink-0"
              />
              <span className="text-[10px] text-amber-100/80">
                {item.issue}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentDetail({ agent }: { agent: AgentState }) {
  return (
    <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-black" style={{ color: agent.color }}>
            {agent.name}
          </div>
          <div className="text-[9px] text-neutral-400">{agent.role}</div>
        </div>
        <div className="text-[9px] text-neutral-500">{agent.model}</div>
      </div>
      <div className="text-[10px] text-neutral-300">
        <span className="text-neutral-500">Current:</span> {agent.currentTask}
      </div>
      <div className="flex flex-wrap gap-1">
        {agent.tools.map((t) => (
          <span
            key={t}
            className="rounded-md border border-neutral-700/50 bg-neutral-800/50 px-1.5 py-0.5 text-[9px] font-semibold text-neutral-300"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
