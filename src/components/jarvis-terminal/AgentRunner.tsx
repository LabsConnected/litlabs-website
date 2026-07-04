"use client";

import { Play, StopCircle, Bot, Shield, Code, HardDrive, LineChart } from "lucide-react";

const agents = [
  { name: "Code Architect", icon: Code, status: "Online" },
  { name: "Security Auditor", icon: Shield, status: "Idle" },
  { name: "DevOps Engineer", icon: HardDrive, status: "Online" },
  { name: "Data Analyst", icon: LineChart, status: "Idle" },
];

export function AgentRunner() {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="h-4 w-4 text-orange-400" />
        <h2 className="font-bold">Agent Runner</h2>
      </div>

      <div className="space-y-2">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.name}
              className="flex items-center justify-between rounded-lg border border-neutral-800 p-3"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-neutral-900 p-1.5">
                  <Icon className="h-4 w-4 text-neutral-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{agent.name}</div>
                  <div className={`text-xs ${agent.status === "Online" ? "text-green-400" : "text-neutral-500"}`}>
                    {agent.status}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button className="rounded bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-500">
                  <Play className="h-3 w-3" />
                </button>
                <button className="rounded bg-neutral-800 px-3 py-1.5 text-xs font-bold text-neutral-400 hover:bg-neutral-700">
                  <StopCircle className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
