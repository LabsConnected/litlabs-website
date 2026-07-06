"use client";

import Link from "next/link";
import { UserPlus, Zap, Bot } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { LC } from "../lit-console-theme";

const SUGGESTED_AGENTS = [
  { handle: "@zero", label: "Zero", role: "Analyst" },
  { handle: "@knight", label: "Knight", role: "Strategist" },
  { handle: "@synapse", label: "Synapse", role: "Memory" },
];

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = (name.charCodeAt(0) * 37) % 360;
  return (
    <div
      className="rounded-full flex items-center justify-center font-black shrink-0 text-[10px]"
      style={{
        width: 28,
        height: 28,
        background: `hsl(${hue},60%,35%)`,
        color: `hsl(${hue},80%,85%)`,
      }}
    >
      {initials}
    </div>
  );
}

export function AgentDiscoveryWidget() {
  return (
    <BentoCard title="Architect Discovery" icon={<Bot size={14} />}>
      <div className="space-y-2">
        {SUGGESTED_AGENTS.map((a) => (
          <div key={a.handle} className="flex items-center gap-2.5">
            <Avatar name={a.label} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold leading-none" style={{ color: LC.text }}>
                {a.handle}
              </div>
              <div className="text-[10px] opacity-40" style={{ color: LC.textMuted }}>
                {a.role}
              </div>
            </div>
            <Link
              href="/agents"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all hover:scale-105"
              style={{
                borderColor: `${LC.accentCyan}40`,
                color: LC.accentCyan,
                backgroundColor: `${LC.accentCyan}08`,
              }}
            >
              <UserPlus size={10} /> Connect
            </Link>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

export function SystemStatusWidget() {
  const systems = [
    { label: "API Gateway", ok: true },
    { label: "Supabase DB", ok: true },
    { label: "AI Inference", ok: true },
    { label: "Media Gen", ok: true },
  ];

  return (
    <BentoCard title="System Status" icon={<Zap size={14} />}>
      <div className="flex flex-col gap-1.5">
        {systems.map((s) => (
          <div key={s.label} className="flex items-center justify-between py-1">
            <span className="text-[10px]" style={{ color: LC.textMuted }}>
              {s.label}
            </span>
            <span
              className="flex items-center gap-1 text-[9px] font-bold"
              style={{ color: s.ok ? LC.success : LC.danger }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: s.ok ? LC.success : LC.danger,
                  boxShadow: s.ok ? `0 0 6px ${LC.success}` : "none",
                }}
              />
              {s.ok ? "Online" : "Degraded"}
            </span>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}
