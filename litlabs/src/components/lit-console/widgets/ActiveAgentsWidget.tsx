"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Bot, Play, Loader2 } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";

const AGENTS = [
  {
    id: "director",
    name: "Director",
    role: "Orchestrator",
    status: "online",
    color: "#00f5ff",
  },
  {
    id: "code-champ",
    name: "Code Champ",
    role: "Engineer",
    status: "idle",
    color: "#ff7a1a",
  },
  {
    id: "writer",
    name: "Writer",
    role: "Content",
    status: "idle",
    color: "#a855f7",
  },
  {
    id: "social-dom",
    name: "Social Dom",
    role: "Social",
    status: "online",
    color: "#22c55e",
  },
  {
    id: "data-slayer",
    name: "Data Slayer",
    role: "Analytics",
    status: "offline",
    color: "#ef4444",
  },
];

export function ActiveAgentsWidget() {
  const { resolvedColors: T } = useTheme();
  const [running, setRunning] = useState<string | null>(null);
  const [lastRuns, setLastRuns] = useState<Record<string, string>>({});

  const runAgent = (id: string) => {
    setRunning(id);
    setTimeout(() => {
      setLastRuns((prev) => ({
        ...prev,
        [id]: `Run completed at ${new Date().toLocaleTimeString()}`,
      }));
      setRunning(null);
    }, 1500);
  };

  return (
    <BentoCard
      title="Active Agents"
      icon={<Bot size={14} />}
      action={
        <Link
          href="/agents"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: T.accentColor }}
        >
          All Agents
        </Link>
      }
    >
      <div className="flex flex-col gap-2">
        {AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between rounded-xl border p-2.5"
            style={{
              borderColor: `${T.borderColor}25`,
              backgroundColor: `${T.borderColor}08`,
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    agent.status === "online"
                      ? T.success
                      : agent.status === "idle"
                        ? "#f59e0b"
                        : "#ef4444",
                  boxShadow: `0 0 8px ${agent.status === "online" ? T.success : agent.status === "idle" ? "#f59e0b" : "#ef4444"}`,
                }}
              />
              <div>
                <div
                  className="text-sm font-bold"
                  style={{ color: T.textColor }}
                >
                  {agent.name}
                </div>
                <div className="text-[10px]" style={{ color: T.textMuted }}>
                  {agent.role}
                  {lastRuns[agent.id] && (
                    <span className="ml-2 opacity-60">
                      • {lastRuns[agent.id]}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => runAgent(agent.id)}
              disabled={running === agent.id}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition disabled:opacity-50"
              style={{
                backgroundColor: `${agent.color}20`,
                color: agent.color,
              }}
            >
              {running === agent.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              Run
            </button>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}
