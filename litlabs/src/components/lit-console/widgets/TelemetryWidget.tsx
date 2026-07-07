"use client";

import { useState, useEffect } from "react";
import { Activity, Clock, Bot, Users } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { LC } from "../lit-console-theme";

type Stats = {
  activeNodes: number;
  agents: number;
  totalUsers: number;
  uptime: string;
  onlineAgents: number;
};

const DEMO_STATS: Stats = {
  activeNodes: 3,
  agents: 8,
  totalUsers: 42,
  uptime: "99.9%",
  onlineAgents: 7,
};

const STAT_CARDS = [
  { key: "activeNodes" as const, label: "Active Nodes", icon: Activity, color: LC.accentCyan },
  { key: "agents" as const, label: "Agents", icon: Bot, color: LC.accentPurple },
  { key: "totalUsers" as const, label: "Users", icon: Users, color: LC.success },
  { key: "uptime" as const, label: "Uptime", icon: Clock, color: LC.accentCyan },
];

export function TelemetryWidget() {
  const [stats, setStats] = useState<Stats>(DEMO_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !data.mock) setStats(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <BentoCard title="Network Telemetry" icon={<Activity size={14} />}>
      <div className="grid grid-cols-2 gap-2">
        {STAT_CARDS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-lg p-2.5 border"
              style={{
                borderColor: `${LC.border}40`,
                backgroundColor: LC.bgSecondary,
              }}
            >
              <Icon size={10} style={{ color: s.color }} className="mb-1" />
              <div
                className="text-xl font-black leading-none"
                style={{ color: s.color }}
              >
                {loading ? "—" : stats[s.key]}
              </div>
              <div className="text-[10px] opacity-40 mt-0.5 uppercase tracking-wider">
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
}
