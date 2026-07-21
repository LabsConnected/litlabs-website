"use client";

/**
 * LiTT Base Station — AgentInspector
 *
 * Right-rail panel that opens when an agent is selected on the canvas.
 * Tabbed interface: Overview, Missions, Tools, Memory.
 */

import { useState } from "react";
import { X, Bot, Wrench, Brain, Target } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS } from "@/lib/agents";
import type { AgentId } from "../store/stationStore";

type InspectorTab = "overview" | "missions" | "tools" | "memory";

interface AgentInspectorProps {
  agentId: AgentId | null;
  onClose: () => void;
  onChatAction?: (agentId: AgentId) => void;
  onAssignAction?: (agentId: AgentId) => void;
  onTerminalAction?: (agentId: AgentId) => void;
}

export default function AgentInspector({
  agentId,
  onClose,
  onChatAction,
  onAssignAction,
  onTerminalAction,
}: AgentInspectorProps) {
  const { resolvedColors: T } = useTheme();
  const [tab, setTab] = useState<InspectorTab>("overview");
  if (!agentId) return null;
  const agent = AGENTS[agentId];
  if (!agent) return null;

  const TABS: { id: InspectorTab; label: string; icon: typeof Bot }[] = [
    { id: "overview", label: "Overview", icon: Bot },
    { id: "missions", label: "Missions", icon: Target },
    { id: "tools", label: "Tools", icon: Wrench },
    { id: "memory", label: "Memory", icon: Brain },
  ];

  return (
    <aside
      className="flex w-full shrink-0 flex-col gap-3 overflow-hidden rounded-2xl border p-4 lg:w-80"
      style={{
        borderColor: `${agent.color}35`,
        backgroundColor: `${T.boxBg}dd`,
      }}
    >
      <header className="flex items-start justify-between">
        <div>
          <div
            className="inline-block rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest"
            style={{ backgroundColor: `${agent.color}22`, color: agent.color }}
          >
            {agent.tag}
          </div>
          <h3 className="mt-1.5 text-lg font-black" style={{ color: T.headerColor }}>
            {agent.name}
          </h3>
          <p className="text-[10px] font-bold" style={{ color: agent.color }}>
            {agent.role}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="grid h-7 w-7 place-items-center rounded-lg"
          style={{ backgroundColor: `${T.borderColor}22`, color: T.textMuted }}
        >
          <X size={13} className="pointer-events-none" aria-hidden="true" />
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border p-1" style={{ borderColor: `${T.borderColor}22` }}>
        {TABS.map(({ id, label, icon: TabIcon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[9px] font-bold transition"
            style={{
              backgroundColor: tab === id ? `${agent.color}25` : "transparent",
              color: tab === id ? agent.color : T.textMuted,
            }}
          >
            <TabIcon size={11} className="pointer-events-none" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" && (
          <div className="space-y-3">
            <section>
              <h4 className="mb-1 text-[9px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
                Personality
              </h4>
              <p className="text-xs italic leading-5" style={{ color: T.textColor }}>
                {agent.personality}
              </p>
            </section>
            <section>
              <h4 className="mb-1 text-[9px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
                Domains ({agent.domains.length})
              </h4>
              <div className="flex flex-wrap gap-1">
                {agent.domains.slice(0, 12).map((d) => (
                  <span
                    key={d}
                    className="rounded-full px-2 py-0.5 text-[9px] font-bold capitalize"
                    style={{ backgroundColor: `${agent.color}15`, color: agent.color }}
                  >
                    {d}
                  </span>
                ))}
                {agent.domains.length > 12 && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                    style={{ backgroundColor: `${T.borderColor}22`, color: T.textMuted }}
                  >
                    +{agent.domains.length - 12} more
                  </span>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "missions" && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Target size={24} style={{ color: T.textMuted }} className="mb-2" aria-hidden="true" />
            <p className="text-xs font-bold" style={{ color: T.textColor }}>No active missions</p>
            <p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>
              Assign a mission to {agent.name} to see it tracked here.
            </p>
          </div>
        )}

        {tab === "tools" && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Wrench size={24} style={{ color: T.textMuted }} className="mb-2" aria-hidden="true" />
            <p className="text-xs font-bold" style={{ color: T.textColor }}>No tools connected</p>
            <p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>
              Tool integrations will appear here when configured.
            </p>
          </div>
        )}

        {tab === "memory" && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Brain size={24} style={{ color: T.textMuted }} className="mb-2" aria-hidden="true" />
            <p className="text-xs font-bold" style={{ color: T.textColor }}>No memories stored</p>
            <p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>
              {agent.name}&apos;s persistent memory will appear here as it learns.
            </p>
          </div>
        )}
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onChatAction?.(agentId)}
          className="rounded-xl border px-2 py-2 text-[10px] font-black"
          style={{ backgroundColor: `${agent.color}20`, borderColor: `${agent.color}40`, color: agent.color }}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={() => onAssignAction?.(agentId)}
          className="rounded-xl border px-2 py-2 text-[10px] font-black"
          style={{ borderColor: `${T.borderColor}35`, color: T.textColor }}
        >
          Assign
        </button>
        <button
          type="button"
          onClick={() => onTerminalAction?.(agentId)}
          className="rounded-xl border px-2 py-2 text-[10px] font-black"
          style={{ borderColor: `${T.borderColor}35`, color: T.textColor }}
        >
          Terminal
        </button>
      </div>
    </aside>
  );
}
