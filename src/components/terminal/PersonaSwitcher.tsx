"use client";

import { usePersona } from "./PersonaContext";
import { PERSONAS, PersonaId } from "@/lib/persona";
import { Terminal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  code: Terminal,
  sparkles: Sparkles,
};

export function PersonaSwitcher() {
  const { personaId, switchPersona, persona } = usePersona();

  return (
    <div className="flex flex-col gap-2 px-2 py-3">
      <span className="px-1 text-[9px] font-black uppercase tracking-[0.18em] text-neutral-400">
        Persona
      </span>
      <div className="flex flex-col gap-1">
        {(Object.keys(PERSONAS) as PersonaId[]).map((id) => {
          const p = PERSONAS[id];
          const Icon = ICONS[p.icon];
          const isActive = id === personaId;

          return (
            <button
              key={id}
              onClick={() => switchPersona(id)}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                isActive ? "bg-white/5" : "hover:bg-white/3",
              )}
              title={`Switch to ${p.name}`}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                style={{
                  backgroundColor: isActive
                    ? `${p.color}20`
                    : "rgba(255,255,255,0.05)",
                  color: p.color,
                }}
              >
                <Icon size={14} strokeWidth={2} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "text-[11px] font-bold truncate",
                    isActive
                      ? "text-neutral-200"
                      : "text-neutral-400 group-hover:text-neutral-300",
                  )}
                >
                  {p.name}
                </span>
                <span className="text-[9px] text-neutral-400 truncate leading-tight">
                  {p.description}
                </span>
              </div>
              {isActive && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${p.color}20`, color: p.color }}
                >
                  {p.tag}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="px-1 text-[9px] text-neutral-400">
        Active: <span style={{ color: persona.color }}>{persona.name}</span>
      </div>
    </div>
  );
}
