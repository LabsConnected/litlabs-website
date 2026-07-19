"use client";

import { Library } from "lucide-react";
import { RETRO_SYSTEMS, type RetroSystemId } from "@/lib/retro-arcade";

type Props = {
  active: RetroSystemId | "all";
  onChange: (system: RetroSystemId | "all") => void;
  counts: Record<string, number>;
  totalCount: number;
};

export default function RetroSystemFilters({ active, onChange, counts, totalCount }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => onChange("all")}
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${
          active === "all"
            ? "bg-fuchsia-500/15 text-fuchsia-300"
            : "text-white/60 hover:bg-white/5 hover:text-white"
        }`}
      >
        <Library size={15} /> All
        <span className="text-xs opacity-60">{totalCount}</span>
      </button>
      {RETRO_SYSTEMS.map((system) => {
        const count = counts[system.id] ?? 0;
        const isActive = active === system.id;
        return (
          <button
            key={system.id}
            onClick={() => onChange(system.id)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${
              isActive
                ? "bg-white/10 text-white"
                : "text-white/55 hover:bg-white/5 hover:text-white"
            }`}
          >
            <i
              className="h-2 w-2 rounded-full"
              style={{
                background: system.color,
                boxShadow: `0 0 10px ${system.color}`,
              }}
            />
            {system.shortName}
            <span className="text-xs opacity-60">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
