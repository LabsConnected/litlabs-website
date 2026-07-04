"use client";

import { useState } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { JarvisAssistantPanel } from "./JarvisAssistantPanel";
import { AgentRunner } from "./AgentRunner";
import { LogsPanel } from "./LogsPanel";
import { CommandHistory } from "./CommandHistory";
import { FileExplorer } from "./FileExplorer";
import { LeftSidebar } from "./LeftSidebar";
import { Cpu, Activity, Zap } from "lucide-react";

export function JarvisTerminalPage() {
  const [activeTab, setActiveTab] = useState<"terminal" | "agents" | "logs">("terminal");
  const [logs, setLogs] = useState<string[]>([
    "[SYSTEM] LiTTree OS Terminal initialized",
    "[SYSTEM] Waiting for terminal server connection...",
    "[AGENT] Code Architect ready",
    "[AGENT] DevOps Engineer ready",
  ]);
  const [commands, setCommands] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  const addLog = (entry: string) => {
    setLogs((prev) => [...prev.slice(-99), entry]);
  };

  const addCommand = (cmd: string) => {
    setCommands((prev) => [...prev.slice(-49), cmd]);
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_1fr_360px]">
        <LeftSidebar />

        <section className="flex flex-col border-x border-neutral-900">
          <header className="flex flex-col gap-4 border-b border-neutral-900 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.35em] text-orange-500">
                LiTTree LabStudios
              </div>
              <h1 className="text-2xl font-bold lg:text-3xl">Jarvis Terminal</h1>
              <p className="text-sm text-neutral-400">
                AI Dev OS • Build, Ship, Scale.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Status label="System" value="Operational" icon={Activity} color="text-green-400" />
              <Status label="Agents" value="3 / 6" icon={Cpu} color="text-orange-400" />
              <Status label="CPU" value="18%" icon={Zap} color="text-blue-400" />
              <div
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  connected ? "bg-green-500/20 text-green-400" : "bg-neutral-800 text-neutral-500"
                }`}
              >
                {connected ? "WebSocket Live" : "WebSocket Offline"}
              </div>
              <button className="rounded-lg bg-orange-600 px-5 py-2 font-bold text-white hover:bg-orange-500">
                Deploy
              </button>
            </div>
          </header>

          <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[240px_1fr]">
            <FileExplorer />

            <div className="flex flex-col gap-4">
              <div className="h-[60vh] min-h-[420px] rounded-xl border border-neutral-800 bg-black">
                <TerminalPanel
                  onLog={addLog}
                  onCommand={addCommand}
                  onConnectionChange={setConnected}
                />
              </div>

              <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
                <LogsPanel logs={logs} />
                <CommandHistory commands={commands} />
              </div>
            </div>
          </div>
        </section>

        <aside className="hidden flex-col border-l border-neutral-900 bg-[#080808] p-4 lg:flex">
          <JarvisAssistantPanel />
          <div className="mt-4">
            <AgentRunner />
          </div>
        </aside>

        <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-neutral-900 bg-[#080808] lg:hidden">
          {[
            { id: "terminal", label: "Terminal" },
            { id: "agents", label: "Agents" },
            { id: "logs", label: "Logs" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 px-3 py-3 text-xs font-bold ${
                activeTab === tab.id ? "bg-orange-600/20 text-orange-400" : "text-neutral-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function Status({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-neutral-500" />
      <div>
        <div className="text-[10px] text-neutral-500">{label}</div>
        <div className={`text-xs font-semibold ${color}`}>{value}</div>
      </div>
    </div>
  );
}
