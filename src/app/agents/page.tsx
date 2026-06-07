"use client";
import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";

interface AgentStatus {
  name: string;
  status: "running" | "idle" | "error" | "fixing";
  lastAction: string;
  uptime: string;
}

interface LogEntry {
  timestamp: string;
  agent: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
}

interface TaskData {
  milestone: string;
  status: string;
  director_instructions: string;
  target_files: string[];
  error_logs: string;
}

export default function AgentsDashboard() {
  const { resolvedColors: T } = useTheme();
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
  const [completedTasks, setCompletedTasks] = useState<string[]>([]);
  const [backlogCount, setBacklogCount] = useState(0);
  const [gitCommits, setGitCommits] = useState<string[]>([]);
  const [services, setServices] = useState<Record<string, string>>({});
  const [lastUpdate, setLastUpdate] = useState("");
  const [crtEnabled, setCrtEnabled] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, logsRes, taskRes, completedRes, backlogRes, gitRes, servicesRes] = await Promise.all([
        fetch("/api/agents/status").then(r => r.json()).catch(() => []),
        fetch("/api/agents/logs").then(r => r.json()).catch(() => []),
        fetch("/api/agents/task").then(r => r.json()).catch(() => null),
        fetch("/api/agents/completed").then(r => r.json()).catch(() => []),
        fetch("/api/agents/backlog").then(r => r.json()).catch(() => 0),
        fetch("/api/agents/commits").then(r => r.json()).catch(() => []),
        fetch("/api/agents/services").then(r => r.json()).catch(() => ({})),
      ]);
      if (agentsRes.length) setAgents(agentsRes);
      if (logsRes.length) setLogs(logsRes);
      if (taskRes) setActiveTask(taskRes);
      if (completedRes.length) setCompletedTasks(completedRes);
      if (backlogRes !== undefined) setBacklogCount(backlogRes);
      if (gitRes.length) setGitCommits(gitRes);
      if (Object.keys(servicesRes).length) setServices(servicesRes);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const val = localStorage.getItem("crt_global_scanlines");
    if (val !== null) setCrtEnabled(val === "true");
  }, []);

  const statusDot = (s: string) => s === "running" ? "bg-green-400 animate-pulse" : s === "fixing" ? "bg-yellow-400 animate-pulse" : s === "error" ? "bg-red-400" : "bg-zinc-600";
  const statusColor = (s: string) => s === "running" ? "text-green-400" : s === "fixing" ? "text-yellow-400" : s === "error" ? "text-red-400" : "text-zinc-500";
  const logColor = (l: string) => l === "error" ? "text-red-400" : l === "warn" ? "text-yellow-400" : l === "success" ? "text-green-400" : "text-zinc-400";

  return (
    <div className="min-h-screen relative font-mono text-xs pb-12" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}

      <div className="w-full bg-black py-1.5 border-b-2 overflow-hidden flex" style={{ borderColor: T.borderColor, color: T.accentColor }}>
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>⚡ HIVE MIND COMMAND CENTER // REAL-TIME AGENT MONITORING</span>
          <span>🤖 ALL SPECIALIST AGENTS REGISTERED // GEMINI API ACTIVE</span>
          <span>📡 LIVE TELEMETRY STREAMING // SYSTEM OPERATIONAL</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex justify-between items-center mb-6 border-2 p-3 bg-black/60 shadow-md" style={{ borderColor: T.borderColor }}>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-wider uppercase" style={{ color: T.headerColor }}>Hive Mind Command Center</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[10px] font-mono" style={{ color: T.accentColor }}>LIVE · {lastUpdate}</span>
            <button
              onClick={() => { const n = !crtEnabled; setCrtEnabled(n); localStorage.setItem("crt_global_scanlines", String(n)); window.dispatchEvent(new Event("storage")); }}
              className="px-3 py-1 text-[10px] font-bold border-2 transition-all hover:scale-105"
              style={{ borderColor: T.accentColor, color: T.accentColor, backgroundColor: "transparent" }}
            >
              CRT: {crtEnabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Agents", value: agents.filter(a => a.status === "running").length, sub: `/${agents.length}`, color: "#56d364" },
            { label: "Backlog", value: backlogCount, sub: "", color: "#f0883e" },
            { label: "Completed", value: completedTasks.length, sub: "", color: "#58a6ff" },
            { label: "Commits", value: gitCommits.length, sub: "", color: "#bc8cff" },
          ].map((s, i) => (
            <div key={i} className="lit-box p-3" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: T.textMuted }}>{s.label}</div>
              <div className="text-xl font-extrabold mt-1" style={{ color: s.color }}>{s.value}<span className="text-xs opacity-50">{s.sub}</span></div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>🤖 Agents</div>
              <div className="space-y-2">
                {agents.map((a, i) => (
                  <div key={i} className="border rounded p-2.5" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${statusDot(a.status)}`} />
                        <span className="text-xs font-semibold" style={{ color: T.textColor }}>{a.name}</span>
                      </div>
                      <span className={`text-[10px] font-mono uppercase ${statusColor(a.status)}`}>{a.status}</span>
                    </div>
                    <div className="text-[10px] mt-1 truncate" style={{ color: T.textMuted }}>{a.lastAction}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lit-box p-4 mt-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>⚙️ Services</div>
              <div className="space-y-1">
                {Object.entries(services).map(([n, s], i) => (
                  <div key={i} className="flex items-center justify-between rounded border px-3 py-1.5" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor }}>
                    <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>{n}</span>
                    <span className={`text-[10px] font-mono ${s === "active" ? "text-green-400" : "text-red-400"}`}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>🎯 Active Task</div>
              {activeTask ? (
                <div className="rounded border p-3 mb-3" style={{ borderColor: "#f0883e40", backgroundColor: "#f0883e08" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm" style={{ color: "#f0883e" }}>{activeTask.milestone}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#f0883e20", color: "#f0883e" }}>{activeTask.status}</span>
                  </div>
                  <p className="text-xs" style={{ color: T.textMuted }}>{activeTask.director_instructions}</p>
                  <div className="text-[10px] mt-1" style={{ color: T.textMuted }}>→ {activeTask.target_files.join(", ")}</div>
                  {activeTask.error_logs && (
                    <div className="mt-2 p-2 rounded border text-[10px] font-mono" style={{ borderColor: "#f8514920", backgroundColor: "#f8514910", color: "#f85149" }}>{activeTask.error_logs}</div>
                  )}
                </div>
              ) : (
                <div className="rounded border p-3 mb-3 text-center text-xs" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor, color: T.textMuted }}>No active task</div>
              )}

              <div className="lit-header -mx-4 -mt-4 mb-3 mt-4" style={{ color: "white" }}>📡 Recent Commits</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {gitCommits.map((c, i) => (
                  <div key={i} className="rounded border px-2 py-1.5 text-[10px] font-mono" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor, color: T.textColor }}>{c}</div>
                ))}
              </div>

              <div className="lit-header -mx-4 -mt-4 mb-3 mt-4" style={{ color: "white" }}>✅ Completed</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {completedTasks.map((t, i) => (
                  <div key={i} className="rounded border px-2 py-1.5 text-[10px]" style={{ borderColor: "#56d36420", backgroundColor: "#56d36408", color: "#56d364" }}>{t}</div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>📋 Live Logs</div>
              <div className="rounded border p-3 h-[500px] overflow-y-auto font-mono text-[10px]" style={{ borderColor: T.borderColor, backgroundColor: "#00000066" }}>
                {logs.map((l, i) => (
                  <div key={i} className="mb-1.5 flex gap-1.5">
                    <span style={{ color: T.textMuted }} className="shrink-0">[{l.timestamp}]</span>
                    <span style={{ color: "#f0883e" }} className="shrink-0">[{l.agent}]</span>
                    <span className={logColor(l.level)}>{l.message}</span>
                  </div>
                ))}
                {logs.length === 0 && <div className="text-center mt-8" style={{ color: T.textMuted }}>Waiting for agent activity...</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
