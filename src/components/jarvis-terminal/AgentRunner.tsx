"use client";

import { useState } from "react";
import { Play, StopCircle, Bot, Shield, Code, HardDrive, LineChart, Loader2 } from "lucide-react";

const agents = [
  { name: "Code Architect", icon: Code, status: "Online" },
  { name: "Security Auditor", icon: Shield, status: "Idle" },
  { name: "DevOps Engineer", icon: HardDrive, status: "Online" },
  { name: "Data Analyst", icon: LineChart, status: "Idle" },
];

export function AgentRunner() {
  const [task, setTask] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runAgent = async (agentName: string) => {
    const prompt = task.trim() || `Run ${agentName} default task`;
    setRunning(agentName);
    setMessage(null);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, task: prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessage(`Agent ${agentName} queued (id: ${data.id?.slice(0, 8) || "n/a"})`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Agent run failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="h-4 w-4 text-orange-400" />
        <h2 className="font-bold">Agent Runner</h2>
      </div>

      <div className="mb-3">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Task for agent..."
          className="w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-xs outline-none focus:border-orange-600"
        />
      </div>

      {message && (
        <div className="mb-3 rounded-lg border border-neutral-800 bg-black p-2 text-xs text-neutral-300">
          {message}
        </div>
      )}

      <div className="space-y-2">
        {agents.map((agent) => {
          const Icon = agent.icon;
          const isRunning = running === agent.name;
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
                <button
                  onClick={() => runAgent(agent.name)}
                  disabled={isRunning}
                  className="rounded bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-500 disabled:opacity-50"
                >
                  {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
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
