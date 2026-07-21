"use client";

/**
 * LiTT Base Station — AgentInspector
 *
 * Right-rail panel that opens when an agent is selected on the canvas.
 * Shows the agent's role, personality, the first 12 domains, and a quick
 * link to the full chat page (`/agents/[slug]`).
 */

import { X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS } from "@/lib/agents";
import type { AgentId } from "../store/stationStore";

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
  if (!agentId) return null;
  const agent = AGENTS[agentId];
  if (!agent) return null;

  return (
    <aside
      className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border p-4 lg:w-80"
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
