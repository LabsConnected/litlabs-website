"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Bot, Sparkles } from "lucide-react";
import type { AgentId } from "@/app/agents/store/stationStore";
import { AGENTS } from "@/lib/agents";

const AGENT_OPTIONS: ReadonlyArray<AgentId> = ["litt", "spark"];

type Props = {
  value: AgentId;
  onChange: (agentId: AgentId) => void;
};

export default function AgentPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const currentAgent = AGENTS[value] ?? AGENTS.litt;
  const Icon = value === "spark" ? Sparkles : Bot;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-black transition hover:opacity-80"
        style={{
          borderColor: `${currentAgent.color}40`,
          backgroundColor: `${currentAgent.color}15`,
          color: currentAgent.color,
        }}
      >
        <Icon size={12} className="pointer-events-none" aria-hidden="true" />
        <span className="max-w-24 truncate">{currentAgent.name}</span>
        <ChevronDown className="pointer-events-none" size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Active agent"
          className="absolute left-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#0b0f1a] p-1 shadow-2xl"
        >
          {AGENT_OPTIONS.map((id) => {
            const agent = AGENTS[id];
            if (!agent) return null;
            const active = id === value;
            const ItemIcon = id === "spark" ? Sparkles : Bot;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] transition hover:bg-white/10"
              >
                <ItemIcon size={13} style={{ color: agent.color }} className="pointer-events-none" aria-hidden="true" />
                <span className="flex-1 font-bold text-white">{agent.name}</span>
                <span className="text-[9px] text-white/40">{agent.role}</span>
                {active && <Check className="pointer-events-none" size={13} style={{ color: agent.color }} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
