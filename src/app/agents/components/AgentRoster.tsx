"use client";

/**
 * LiTT Base Station — AgentRoster
 *
 * Sidebar tile that lists every visible copilot (LiTT + Spark), with
 * online status, role, and a quick-launch button. Reads from the canonical
 * `AGENTS` registry in `src/lib/agents.ts` so adding a new agent there
 * automatically adds it to the roster (no UI change required).
 */

import { Bot, Sparkles as SparkIcon, Circle, ArrowRight } from "lucide-react";
import type { AgentId } from "../store/stationStore";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS } from "@/lib/agents";

const AGENT_ORDER: ReadonlyArray<"litt" | "spark"> = ["litt", "spark"];

interface AgentRosterProps {
  selectedAgentId: AgentId | null;
  onSelectAgentAction: (agentId: AgentId) => void;
  busyAgentId?: AgentId | null;
}

type RuntimeStatus = "available" | "working" | "offline";

const STATUS_CONFIG: Record<RuntimeStatus, { color: string; label: string; pulse: boolean }> = {
  available: { color: "#22c55e", label: "Available", pulse: false },
  working: { color: "#f59e0b", label: "Working", pulse: true },
  offline: { color: "#6b7280", label: "Offline", pulse: false },
};

export default function AgentRoster({ selectedAgentId, onSelectAgentAction, busyAgentId }: AgentRosterProps) {
  const { resolvedColors: T } = useTheme();
  return (
    <section
      className="rounded-2xl border p-3"
      style={{
        borderColor: `${T.accentColor}25`,
        backgroundColor: `${T.boxBg}cc`,
      }}
    >
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={13} style={{ color: T.accentColor }} />
          <h3 className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>
            Crew
          </h3>
        </div>
        <span className="text-[9px] font-bold" style={{ color: T.textMuted }}>
          {AGENT_ORDER.length} on station
        </span>
      </header>
      <div className="space-y-1.5">
        {AGENT_ORDER.map((id) => {
          const agent = AGENTS[id];
          if (!agent) return null;
          const Icon = id === "spark" ? SparkIcon : Bot;
          const status: RuntimeStatus = busyAgentId === id ? "working" : "available";
          const statusCfg = STATUS_CONFIG[status];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectAgentAction(id)}
              aria-pressed={selectedAgentId === id}
              className="group flex w-full items-center gap-2 rounded-xl border p-2 text-left transition-all hover:-translate-y-px"
              style={{
                borderColor: `${agent.color}30`,
                backgroundColor: selectedAgentId === id ? `${agent.color}20` : `${agent.color}10`,
                color: T.textColor,
                boxShadow: selectedAgentId === id ? `0 0 24px ${agent.color}22` : "none",
              }}
            >
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                style={{ backgroundColor: `${agent.color}22`, color: agent.color }}
              >
                <Icon size={14} className="pointer-events-none" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[11px] font-black" style={{ color: T.headerColor }}>
                    {agent.name}
                  </span>
                  <span className="flex items-center gap-1">
                    <Circle size={5} className={`pointer-events-none fill-current ${statusCfg.pulse ? "animate-pulse" : ""}`} style={{ color: statusCfg.color }} aria-hidden="true" />
                    <span className="text-[8px] font-bold uppercase" style={{ color: statusCfg.color }}>
                      {statusCfg.label}
                    </span>
                  </span>
                </div>
                <div className="truncate text-[9px]" style={{ color: T.textMuted }}>
                  {agent.role}
                </div>
              </div>
              <ArrowRight size={12} className="pointer-events-none opacity-30 transition-opacity group-hover:opacity-100" style={{ color: T.textMuted }} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
