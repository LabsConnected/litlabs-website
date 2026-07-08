"use client";

import {
  Terminal,
  FileCode,
  Logs,
  Command,
  Rocket,
  Bot,
  ScanLine,
  Bug,
  CheckCircle2,
  Brain,
  History,
} from "lucide-react";

const LIT_TOOLS = [
  { icon: Terminal, label: "Terminal", connected: true },
  { icon: FileCode, label: "File System", connected: true },
  { icon: Logs, label: "Logs", connected: true },
  { icon: Command, label: "Command History", connected: true },
  { icon: Bot, label: "Agents", connected: true },
  { icon: Rocket, label: "Deployments", connected: true },
];

const LIT_CAPABILITIES = [
  { icon: ScanLine, label: "Scan project" },
  { icon: Bug, label: "Explain errors" },
  { icon: Terminal, label: "Generate commands" },
  { icon: FileCode, label: "Apply code fixes" },
  { icon: CheckCircle2, label: "Run terminal commands with approval" },
  { icon: Bot, label: "Start agents" },
  { icon: Rocket, label: "Deploy app" },
  { icon: Brain, label: "Context-aware AI responses" },
];

const RECENT_RUNS = [
  { action: "Project scan", time: "2 min ago", status: "completed" },
  { action: "Build check", time: "15 min ago", status: "completed" },
  { action: "Deploy staging", time: "1 hour ago", status: "completed" },
];

export function LittCodeToolGrid() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-neutral-500">
          Connected Tools
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LIT_TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <div
                key={tool.label}
                className="flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-sm"
              >
                <Icon className="h-4 w-4 text-green-400" />
                <span className="text-neutral-200">{tool.label}</span>
                <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-400" />
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-neutral-500">
          Capabilities
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LIT_CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.label}
                className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs text-neutral-300"
              >
                <Icon className="h-3.5 w-3.5 text-orange-400" />
                {cap.label}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-neutral-500">
          <History className="h-3.5 w-3.5" /> Recent Activity
        </h3>
        <div className="space-y-2">
          {RECENT_RUNS.map((run, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm"
            >
              <span className="text-neutral-200">{run.action}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">{run.time}</span>
                <span className="flex items-center gap-1 text-xs font-bold text-green-400">
                  <CheckCircle2 className="h-3 w-3" /> {run.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
