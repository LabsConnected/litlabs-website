"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import PageShell from "@/components/PageShell";
import { RefreshCw, Search, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

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

/* ─── Agent icon map ─────────────────────────────────────────────── */
const AGENT_ICONS: Record<string, string> = {
  Director: "🎯", Champion: "🏆", "Code Champion": "💻",
  "Social Dominator": "📱", "Data Slayer": "📊", "Writing Coach": "✍️", "Music Producer": "🎵",
};
const AGENT_COLORS: Record<string, string> = {
  Director: "#00ffff", Champion: "#ff0080", "Code Champion": "#00ff41",
  "Social Dominator": "#ff6b6b", "Data Slayer": "#ffff00", "Writing Coach": "#ff9ff3", "Music Producer": "#9b59b6",
};

function getIcon(name: string) { return AGENT_ICONS[name] || "🤖"; }
function getColor(name: string) { return AGENT_COLORS[name] || "#ffffff"; }

const STATUS_CONFIG = {
  running: { label: "Running", dot: "bg-green-400", text: "text-green-400", glow: "#22c55e" },
  idle:    { label: "Idle",    dot: "bg-zinc-500",  text: "text-zinc-400",  glow: "#71717a" },
  error:   { label: "Error",  dot: "bg-red-400",   text: "text-red-400",   glow: "#f87171" },
  fixing:  { label: "Fixing", dot: "bg-yellow-400 animate-pulse", text: "text-yellow-400", glow: "#facc15" },
};

const LOG_COLORS = {
  error:   "#f87171",
  warn:    "#facc15",
  success: "#4ade80",
  info:    "#94a3b8",
};

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
  const [logFilter, setLogFilter] = useState("");
  const [copiedLog, setCopiedLog] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

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
      if (Array.isArray(agentsRes) && agentsRes.length) setAgents(agentsRes);
      if (Array.isArray(logsRes) && logsRes.length) setLogs(logsRes);
      if (taskRes) setActiveTask(taskRes);
      if (Array.isArray(completedRes) && completedRes.length) setCompletedTasks(completedRes);
      if (backlogRes !== undefined) setBacklogCount(backlogRes);
      if (Array.isArray(gitRes) && gitRes.length) setGitCommits(gitRes);
      if (typeof servicesRes === "object") setServices(servicesRes);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter(l =>
    !logFilter || l.message.toLowerCase().includes(logFilter.toLowerCase()) || l.agent.toLowerCase().includes(logFilter.toLowerCase())
  );

  const copyLogs = () => {
    navigator.clipboard.writeText(filteredLogs.map(l => `[${l.timestamp}] [${l.agent}] ${l.message}`).join("\n"));
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const runningCount = agents.filter(a => a.status === "running").length;
  const errorCount   = agents.filter(a => a.status === "error").length;

  /* ── Fallback demo agents when API returns nothing ── */
  const displayAgents: AgentStatus[] = agents.length > 0 ? agents : [
    { name: "Director",        status: "running", lastAction: "Monitoring platform health",      uptime: "2h 14m" },
    { name: "Champion",        status: "idle",    lastAction: "Awaiting user queries",            uptime: "2h 14m" },
    { name: "Code Champion",   status: "running", lastAction: "Reviewing TypeScript changes",     uptime: "1h 52m" },
    { name: "Social Dominator",status: "idle",    lastAction: "Content calendar up to date",      uptime: "2h 14m" },
    { name: "Data Slayer",     status: "idle",    lastAction: "Telemetry stream nominal",         uptime: "2h 14m" },
    { name: "Writing Coach",   status: "idle",    lastAction: "Standing by for content requests", uptime: "2h 14m" },
    { name: "Music Producer",  status: "idle",    lastAction: "Waiting for audio prompt",         uptime: "2h 14m" },
  ];

  const kpis = [
    { label: "Active",    value: runningCount || displayAgents.filter(a=>a.status==="running").length, sub: `/${displayAgents.length}`,  color: "#22c55e", icon: "⚡" },
    { label: "Backlog",   value: backlogCount,          sub: " tasks",   color: "#f97316", icon: "📋" },
    { label: "Completed", value: completedTasks.length, sub: " tasks",   color: "#60a5fa", icon: "✅" },
    { label: "Commits",   value: gitCommits.length,     sub: " recent",  color: "#c084fc", icon: "🔀" },
  ];

  return (
    <PageShell title="Hive Mind" subtitle="Real-time agent monitoring & orchestration" className="font-mono text-xs relative">

      {/* ── Ticker ── */}
      <div className="w-full overflow-hidden flex h-7 items-center border-b" style={{ borderColor: T.borderColor + "20", backgroundColor: T.bgColor + "cc" }}>
        <div className="whitespace-nowrap animate-marquee flex gap-16 text-[9px] font-bold uppercase tracking-wider px-4" style={{ color: T.accentColor }}>
          <span>⚡ HIVE MIND COMMAND CENTER</span>
          <span style={{ color: T.linkColor }}>🤖 {displayAgents.length} AGENTS REGISTERED · GEMINI API ACTIVE</span>
          <span>📡 LIVE TELEMETRY STREAMING</span>
          <span style={{ color: T.linkColor }}>🔄 AUTO-SYNC EVERY 5s</span>
          <span>⚡ HIVE MIND COMMAND CENTER</span>
          <span style={{ color: T.linkColor }}>🤖 {displayAgents.length} AGENTS REGISTERED · GEMINI API ACTIVE</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5 space-y-5">

        {/* ── Header bar ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-bold" style={{ color: T.accentColor }}>LIVE</span>
            </div>
            {lastUpdate && <span className="text-[9px] font-mono opacity-40" style={{ color: T.textMuted }}>Last sync {lastUpdate}</span>}
            {errorCount > 0 && (
              <span className="text-[9px] px-2 py-0.5 rounded-full font-bold animate-pulse" style={{ background: "#f8514920", color: "#f85149", border: "1px solid #f8514930" }}>
                ⚠ {errorCount} error{errorCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button onClick={fetchData} className="flex items-center gap-1.5 text-[9px] px-2.5 py-1 rounded border opacity-60 hover:opacity-100 transition-all"
            style={{ borderColor: T.borderColor + "30", color: T.textMuted }}>
            <RefreshCw size={10} /> Refresh
          </button>
        </div>

        {/* ── KPI tiles ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {kpis.map((k, i) => (
            <div key={i} className="rounded-xl p-3 relative overflow-hidden" style={{ backgroundColor: T.boxBg, border: `1px solid ${k.color}20`, boxShadow: `0 0 20px ${k.color}08` }}>
              <div className="absolute inset-0 opacity-5" style={{ background: `radial-gradient(circle at bottom right, ${k.color}, transparent 70%)` }} />
              <div className="text-lg mb-1">{k.icon}</div>
              <div className="text-[9px] uppercase tracking-widest font-bold mb-1" style={{ color: T.textMuted }}>{k.label}</div>
              <div className="text-2xl font-black leading-none" style={{ color: k.color }}>
                {k.value}<span className="text-[10px] font-normal opacity-50 ml-0.5">{k.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Agent Cards ── */}
          <div className="space-y-3">
            <div className="text-[9px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: T.accentColor }}>
              <span className="w-1 h-3 rounded-sm" style={{ backgroundColor: T.accentColor }} />
              Agent Roster
            </div>
            {displayAgents.map((a, i) => {
              const sc = STATUS_CONFIG[a.status] || STATUS_CONFIG.idle;
              const color = getColor(a.name);
              const isExpanded = expandedAgent === a.name;
              return (
                <div key={i} className="rounded-xl overflow-hidden transition-all cursor-pointer"
                  style={{ backgroundColor: T.boxBg, border: `1px solid ${isExpanded ? color + "40" : T.borderColor + "15"}`, boxShadow: isExpanded ? `0 0 16px ${color}10` : "none" }}
                  onClick={() => setExpandedAgent(isExpanded ? null : a.name)}>
                  <div className="px-3 py-2.5 flex items-center gap-3">
                    {/* Icon + glow */}
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0" style={{ backgroundColor: color + "12", border: `1px solid ${color}25` }}>
                      {getIcon(a.name)}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold truncate" style={{ color: T.textColor }}>{a.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} style={{ boxShadow: `0 0 5px ${sc.glow}` }} />
                          <span className={`text-[9px] font-bold ${sc.text}`}>{sc.label}</span>
                          {isExpanded ? <ChevronUp size={9} style={{ color: T.textMuted }} /> : <ChevronDown size={9} style={{ color: T.textMuted }} />}
                        </div>
                      </div>
                      <div className="text-[9px] truncate mt-0.5" style={{ color: T.textMuted }}>{a.lastAction}</div>
                    </div>
                  </div>
                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-0 border-t space-y-2" style={{ borderColor: color + "15" }}>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.3)" }}>
                          <div className="text-[8px] uppercase tracking-widest opacity-50 mb-0.5" style={{ color: T.textMuted }}>Uptime</div>
                          <div className="text-[10px] font-bold font-mono" style={{ color }}>{a.uptime || "—"}</div>
                        </div>
                        <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.3)" }}>
                          <div className="text-[8px] uppercase tracking-widest opacity-50 mb-0.5" style={{ color: T.textMuted }}>Status</div>
                          <div className={`text-[10px] font-bold uppercase ${sc.text}`}>{sc.label}</div>
                        </div>
                      </div>
                      <div className="text-[9px] leading-relaxed opacity-60" style={{ color: T.textColor }}>{a.lastAction}</div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Services */}
            {Object.keys(services).length > 0 && (
              <div className="rounded-xl p-3" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}15` }}>
                <div className="text-[9px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: T.accentColor }}>
                  <span className="w-1 h-3 rounded-sm" style={{ backgroundColor: T.accentColor }} />Services
                </div>
                <div className="space-y-1.5">
                  {Object.entries(services).map(([n, s], i) => (
                    <div key={i} className="flex items-center justify-between px-2 py-1 rounded-lg" style={{ background: "rgba(0,0,0,0.25)" }}>
                      <span className="text-[9px] font-mono" style={{ color: T.textMuted }}>{n}</span>
                      <div className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${s === "active" ? "bg-green-400" : "bg-red-400"}`} />
                        <span className={`text-[9px] font-bold ${s === "active" ? "text-green-400" : "text-red-400"}`}>{s}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Center: Task pipeline + Commits ── */}
          <div className="space-y-4">
            {/* Task pipeline */}
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}15` }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-1.5" style={{ borderColor: T.borderColor + "15" }}>
                <span className="w-1 h-3 rounded-sm" style={{ backgroundColor: "#f97316" }} />
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#f97316" }}>Task Pipeline</span>
              </div>
              <div className="p-3 space-y-3">
                {/* Kanban */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Backlog",     value: backlogCount,      color: "#94a3b8" },
                    { label: "In Progress", value: activeTask ? 1 : 0, color: "#f97316" },
                    { label: "Done",        value: completedTasks.length, color: "#22c55e" },
                  ].map((col, i) => (
                    <div key={i} className="rounded-lg py-2 px-1" style={{ background: col.color + "10", border: `1px solid ${col.color}20` }}>
                      <div className="text-xl font-black" style={{ color: col.color }}>{col.value}</div>
                      <div className="text-[8px] uppercase tracking-wider mt-0.5" style={{ color: col.color, opacity: 0.7 }}>{col.label}</div>
                    </div>
                  ))}
                </div>

                {/* Active task card */}
                {activeTask ? (
                  <div className="rounded-lg p-3" style={{ background: "#f9731608", border: "1px solid #f9731630" }}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-bold leading-tight" style={{ color: "#f97316" }}>{activeTask.milestone}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full shrink-0 font-bold" style={{ background: "#f9731620", color: "#f97316" }}>{activeTask.status}</span>
                    </div>
                    <p className="text-[9px] leading-relaxed opacity-70 mb-1.5" style={{ color: T.textColor }}>{activeTask.director_instructions}</p>
                    {activeTask.target_files.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {activeTask.target_files.map((f, i) => (
                          <span key={i} className="text-[8px] px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(0,0,0,0.3)", color: T.textMuted }}>{f.split("/").pop()}</span>
                        ))}
                      </div>
                    )}
                    {activeTask.error_logs && (
                      <div className="mt-2 p-2 rounded text-[9px] font-mono" style={{ background: "#f8514910", border: "1px solid #f8514920", color: "#f85149" }}>{activeTask.error_logs}</div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg py-4 text-center" style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${T.borderColor}10` }}>
                    <div className="text-lg mb-1">✨</div>
                    <div className="text-[9px]" style={{ color: T.textMuted }}>No active task</div>
                  </div>
                )}
              </div>
            </div>

            {/* Git commits */}
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}15` }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-1.5" style={{ borderColor: T.borderColor + "15" }}>
                <span className="w-1 h-3 rounded-sm" style={{ backgroundColor: "#c084fc" }} />
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#c084fc" }}>Recent Commits</span>
              </div>
              <div className="p-2 space-y-1 max-h-44 overflow-y-auto">
                {gitCommits.length > 0 ? gitCommits.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(0,0,0,0.2)" }}>
                    <span className="text-[8px] font-mono mt-0.5 shrink-0" style={{ color: "#c084fc" }}>●</span>
                    <span className="text-[9px] font-mono leading-relaxed" style={{ color: T.textColor }}>{c}</span>
                  </div>
                )) : (
                  <div className="py-4 text-center text-[9px]" style={{ color: T.textMuted }}>No commits loaded</div>
                )}
              </div>
            </div>

            {/* Completed tasks */}
            {completedTasks.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ backgroundColor: T.boxBg, border: `1px solid #22c55e15` }}>
                <div className="px-4 py-2.5 border-b flex items-center gap-1.5" style={{ borderColor: "#22c55e15" }}>
                  <span className="w-1 h-3 rounded-sm bg-green-400" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-green-400">Completed</span>
                </div>
                <div className="p-2 space-y-1 max-h-32 overflow-y-auto">
                  {completedTasks.map((t, i) => (
                    <div key={i} className="text-[9px] px-2 py-1 rounded" style={{ background: "#22c55e08", color: "#4ade80" }}>✓ {t}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Live log terminal ── */}
          <div className="rounded-xl overflow-hidden flex flex-col" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}15`, minHeight: "500px" }}>
            {/* Terminal header */}
            <div className="px-3 py-2 border-b flex items-center justify-between shrink-0" style={{ borderColor: T.borderColor + "15", background: "rgba(0,0,0,0.3)" }}>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 opacity-80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-80" />
                </div>
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>Live Log Stream</span>
                <span className="text-[8px] font-mono px-1 rounded" style={{ background: T.accentColor + "20", color: T.accentColor }}>{filteredLogs.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setAutoScroll(p => !p)} title="Toggle auto-scroll"
                  className="text-[8px] px-1.5 py-0.5 rounded border font-bold transition-all"
                  style={{ borderColor: autoScroll ? T.accentColor + "40" : T.borderColor + "20", color: autoScroll ? T.accentColor : T.textMuted, background: autoScroll ? T.accentColor + "10" : "transparent" }}>
                  AUTO
                </button>
                <button onClick={copyLogs} title="Copy all logs"
                  className="p-1 rounded border opacity-60 hover:opacity-100 transition-all"
                  style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
                  {copiedLog ? <Check size={9} className="text-green-400" /> : <Copy size={9} />}
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="px-3 py-1.5 border-b shrink-0" style={{ borderColor: T.borderColor + "10" }}>
              <div className="flex items-center gap-1.5" style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${T.borderColor}15`, borderRadius: "6px", padding: "3px 8px" }}>
                <Search size={9} style={{ color: T.textMuted, opacity: 0.5 }} />
                <input value={logFilter} onChange={e => setLogFilter(e.target.value)}
                  placeholder="Filter logs..."
                  className="flex-1 bg-transparent outline-none text-[9px] font-mono"
                  style={{ color: T.textColor }} />
              </div>
            </div>

            {/* Log entries */}
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[9px] space-y-0.5" style={{ background: "rgba(0,0,0,0.35)" }}>
              {filteredLogs.length > 0 ? filteredLogs.map((l, i) => (
                <div key={i} className="flex gap-1.5 px-1 py-0.5 rounded hover:bg-white/5 transition-colors">
                  <span className="shrink-0 opacity-40" style={{ color: T.textMuted }}>[{l.timestamp}]</span>
                  <span className="shrink-0 font-bold" style={{ color: AGENT_COLORS[l.agent] || "#f97316" }}>[{l.agent}]</span>
                  <span className="leading-relaxed" style={{ color: LOG_COLORS[l.level] || T.textColor }}>{l.message}</span>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="text-2xl mb-2 opacity-30">📡</div>
                  <div className="opacity-30" style={{ color: T.textMuted }}>
                    {logFilter ? "No matching logs" : "Waiting for agent activity..."}
                  </div>
                  <div className="mt-3 flex gap-1">
                    {[...Array(3)].map((_, i) => (
                      <span key={i} className="w-1 h-1 rounded-full bg-green-400 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>

        </div>
      </div>
    </PageShell>
  );
}

