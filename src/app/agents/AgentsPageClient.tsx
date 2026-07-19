"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS } from "@/lib/agents";
import {
  Bot,
  Play,
  Settings,
  Activity,
  Zap,
  Brain,
  Code,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertCircle,
  Cpu,
  Sparkles,
  Target,
  Loader2,
  XCircle,
} from "lucide-react";

type TaskStatus = "queued" | "processing" | "success" | "failed" | "cancelled";

type AgentTask = {
  id: string;
  assigned_to: string;
  dispatcher: string;
  task_input: { prompt?: string; title?: string; [k: string]: unknown };
  task_output: Record<string, unknown> | null;
  status: TaskStatus;
  result_summary: string | null;
  created_at: string;
  updated_at: string;
};

type LoadState = "loading" | "loaded" | "error";

function routeObjective(objective: string): {
  agentId: string;
  agentName: string;
  reason: string;
} {
  const lower = objective.toLowerCase();
  const codeKeywords = [
    "fix", "debug", "code", "build", "deploy", "test", "mobile",
    "navigation", "ui", "api", "database", "refactor", "type",
    "component", "route", "server", "auth", "supabase", "stripe",
  ];
  const directorKeywords = [
    "plan", "strategy", "launch", "market", "coordinate", "research",
    "content", "copy", "brand", "design", "social", "growth", "seo",
    "analytics", "creative", "image", "video", "music", "audio",
  ];

  const codeScore = codeKeywords.filter((k) => lower.includes(k)).length;
  const directorScore = directorKeywords.filter((k) => lower.includes(k)).length;

  if (codeScore >= directorScore && codeScore > 0) {
    return {
      agentId: "littcode",
      agentName: "LiTT-Code",
      reason: "Engineering, debugging, and implementation required",
    };
  }
  if (directorScore > 0) {
    return {
      agentId: "littlebit",
      agentName: "LiTTle-Bit",
      reason: "Strategic planning and coordination required",
    };
  }
  return {
    agentId: "littlebit",
    agentName: "LiTTle-Bit",
    reason: "Task analysis and routing required",
  };
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "queued": return "Queued";
    case "processing": return "Running";
    case "success": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function statusColor(status: TaskStatus): string {
  switch (status) {
    case "queued": return "#f59e0b";
    case "processing": return "#22d3ee";
    case "success": return "#10b981";
    case "failed": return "#ef4444";
    case "cancelled": return "#64748b";
    default: return "#64748b";
  }
}

function statusIcon(status: TaskStatus, size = 12) {
  switch (status) {
    case "queued": return <Clock size={size} />;
    case "processing": return <Loader2 size={size} className="animate-spin" />;
    case "success": return <CheckCircle size={size} />;
    case "failed": return <AlertCircle size={size} />;
    case "cancelled": return <XCircle size={size} />;
    default: return <Clock size={size} />;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AgentsPageClient() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const [command, setCommand] = useState("");
  const [routing, setRouting] = useState<{
    agentId: string;
    agentName: string;
    reason: string;
  } | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const agents = Object.values(AGENTS).filter((a) => a.id !== "pixel-forge");
  const littCode = agents.find((a) => a.id === "littcode");
  const littleBit = agents.find((a) => a.id === "littlebit");

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTasks(data.tasks || []);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleCommandSubmit = async () => {
    const objective = command.trim();
    if (!objective || submitting) return;

    const route = routeObjective(objective);
    setRouting(route);
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/agent-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedTo: route.agentId,
          dispatcher: "user",
          taskInput: {
            prompt: objective,
            title: objective.slice(0, 80),
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create mission");
      }

      await fetchTasks();
      setCommand("");

      setTimeout(() => {
        router.push(
          `/studio?agent=${route.agentId}&mission=${encodeURIComponent(objective)}`,
        );
      }, 1500);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to create mission",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const getAgentForTask = (task: AgentTask) => {
    const id = task.assigned_to.toLowerCase();
    return agents.find((a) => a.id === id) || null;
  };

  const tasksForAgent = (agentId: string) =>
    tasks.filter((t) => t.assigned_to.toLowerCase() === agentId);

  const activeTaskForAgent = (agentId: string) => {
    const agentTasks = tasksForAgent(agentId);
    return agentTasks.find((t) => t.status === "processing")
      || agentTasks.find((t) => t.status === "queued")
      || null;
  };

  return (
    <main
      className="h-full overflow-y-auto pb-20 relative"
      style={{
        backgroundColor: T.bgColor,
        color: T.textColor,
        backgroundImage: `radial-gradient(circle at 20% 50%, ${T.accentColor}08 0%, transparent 50%), radial-gradient(circle at 80% 80%, ${T.linkColor}06 0%, transparent 50%)`,
      }}
    >
      {/* Circuit tree background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-20 left-10 w-64 h-64 opacity-10"
          style={{ color: T.accentColor }}
        >
          <Brain size={256} />
        </div>
        <div
          className="absolute bottom-20 right-10 w-48 h-48 opacity-10"
          style={{ color: T.linkColor }}
        >
          <Cpu size={192} />
        </div>
      </div>

      {/* Header with universal command */}
      <section className="max-w-7xl mx-auto px-4 pt-8 pb-6 relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
              boxShadow: `0 0 20px ${T.accentColor}40`,
            }}
          >
            <Bot size={24} className="text-white" />
          </div>
          <div>
            <h1
              className="text-3xl font-black"
              style={{ color: T.headerColor }}
            >
              Your AI Crew
            </h1>
            <p className="text-sm mt-1" style={{ color: T.textMuted }}>
              Direct the right agent, monitor active missions, and continue work
              inside Studio.
            </p>
          </div>
        </div>

        {/* Universal command input */}
        <div className="relative">
          <div
            className="rounded-2xl border p-4"
            style={{
              backgroundColor: T.boxBg + "90",
              borderColor: T.borderColor + "30",
              backdropFilter: "blur(10px)",
            }}
          >
            <label
              className="block text-xs font-black uppercase tracking-wider mb-2"
              style={{ color: T.textMuted }}
            >
              What do you need done?
            </label>
            <div className="flex gap-3">
              <input
                id="agents-command"
                name="agentsCommand"
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleCommandSubmit()}
                placeholder="Build a page, fix code, create content, plan a launch…"
                className="flex-1 bg-transparent border-none outline-none text-base placeholder:opacity-50"
                style={{ color: T.textColor }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCommandSubmit}
                  className="px-4 py-2 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: T.accentColor,
                    color: "#000",
                  }}
                >
                  Assign Automatically
                </button>
                <Link
                  href="/studio"
                  className="px-4 py-2 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: T.bgColor + "60",
                    color: T.textColor,
                    border: `1px solid ${T.borderColor}30`,
                  }}
                >
                  Open Studio
                </Link>
                <Link
                  href="/studio"
                  className="px-4 py-2 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.1)",
                    color: T.textColor,
                    border: `1px solid ${T.borderColor}20`,
                  }}
                >
                  Create Agent
                </Link>
              </div>
            </div>
          </div>

          {/* Submit error */}
          {submitError && (
            <div
              className="absolute top-full left-0 right-0 mt-2 p-3 rounded-xl z-20"
              style={{
                backgroundColor: T.boxBg,
                border: `1px solid #ef444440`,
              }}
            >
              <div className="flex items-center gap-2 text-sm" style={{ color: "#ef4444" }}>
                <AlertCircle size={16} />
                {submitError}
              </div>
            </div>
          )}

          {/* Routing result overlay */}
          {routing && (
            <div
              className="absolute top-full left-0 right-0 mt-2 p-3 rounded-xl z-20"
              style={{
                backgroundColor: T.boxBg,
                border: `1px solid ${T.accentColor}40`,
                boxShadow: `0 4px 20px ${T.accentColor}20`,
              }}
            >
              <div className="flex items-center gap-2">
                <Target size={16} style={{ color: T.accentColor }} />
                <span className="text-sm font-bold">
                  Assigned to {routing.agentName}
                </span>
                <span className="text-xs" style={{ color: T.textMuted }}>
                  • {routing.reason}
                </span>
                {submitting && (
                  <span className="text-xs" style={{ color: T.accentColor }}>
                    <Loader2 size={12} className="inline animate-spin" /> Creating mission…
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Agent cards */}
      <section className="max-w-7xl mx-auto px-4 mt-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LiTT-Code Card */}
          {littCode && (
            <div
              className="group rounded-3xl border p-6 relative overflow-hidden transition-all duration-300 hover:scale-[1.02]"
              style={{
                backgroundColor: T.boxBg + "90",
                borderColor: "#22d3ee30",
                backgroundImage: `linear-gradient(135deg, #22d3ee08 0%, transparent 100%)`,
              }}
            >
              {/* Status ring */}
              <div className="absolute top-4 right-4">
                <div className="relative">
                  <div
                    className="w-3 h-3 rounded-full animate-pulse"
                    style={{
                      backgroundColor: "#22d3ee",
                      boxShadow: `0 0 12px #22d3ee`,
                    }}
                  />
                  <div
                    className="absolute inset-0 w-3 h-3 rounded-full animate-ping"
                    style={{ backgroundColor: "#22d3ee" }}
                  />
                </div>
              </div>

              {/* Agent header */}
              <div className="flex items-start gap-4 mb-4">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, #22d3ee, #0891b2)`,
                    boxShadow: `0 0 20px #22d3ee40`,
                  }}
                >
                  <Code size={28} className="text-white" />
                </div>
                <div className="flex-1">
                  <h2
                    className="text-2xl font-black"
                    style={{ color: T.headerColor }}
                  >
                    LiTT-Code
                  </h2>
                  <p
                    className="text-sm font-bold uppercase tracking-wider"
                    style={{ color: "#22d3ee" }}
                  >
                    Engineering Agent
                  </p>
                  <p className="text-xs mt-1" style={{ color: T.textMuted }}>
                    Ready · Qwen Code
                  </p>
                </div>
              </div>

              {/* Capabilities */}
              <div className="mb-4">
                <p
                  className="text-xs font-black uppercase tracking-wider mb-2"
                  style={{ color: T.textMuted }}
                >
                  Capabilities
                </p>
                <p className="text-sm" style={{ color: T.textColor }}>
                  Builds, debugs, reviews, deploys
                </p>
              </div>

              {/* Current activity from real tasks */}
              <div className="mb-4">
                <p
                  className="text-xs font-black uppercase tracking-wider mb-2"
                  style={{ color: T.textMuted }}
                >
                  Current Activity
                </p>
                {(() => {
                  const active = activeTaskForAgent("littcode");
                  if (!active) {
                    return (
                      <div
                        className="rounded-lg p-3 text-xs"
                        style={{
                          backgroundColor: "#22d3ee08",
                          border: "1px solid #22d3ee20",
                          color: T.textMuted,
                        }}
                      >
                        No active mission
                      </div>
                    );
                  }
                  return (
                    <div
                      className="rounded-lg p-3"
                      style={{
                        backgroundColor: "#22d3ee08",
                        border: `1px solid ${statusColor(active.status)}30`,
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold truncate max-w-[70%]">
                          {active.task_input?.title || active.task_input?.prompt || "Untitled mission"}
                        </span>
                        <span className="text-xs flex items-center gap-1" style={{ color: statusColor(active.status) }}>
                          {statusIcon(active.status)} {statusLabel(active.status)}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: T.textMuted }}>
                        {timeAgo(active.created_at)}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => router.push(`/studio?agent=littcode`)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: "#22d3ee15",
                    color: "#22d3ee",
                    border: "1px solid #22d3ee30",
                  }}
                >
                  <Play size={14} /> Start Mission
                </button>
                <button
                  onClick={() => router.push(`/studio?agent=littcode&configure=true`)}
                  className="px-3 py-2.5 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: T.bgColor + "60",
                    color: T.textColor,
                    border: `1px solid ${T.borderColor}30`,
                  }}
                >
                  <Settings size={14} />
                </button>
                <button
                  onClick={() => router.push(`/studio?agent=littcode&activity=true`)}
                  className="px-3 py-2.5 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: T.bgColor + "60",
                    color: T.textColor,
                    border: `1px solid ${T.borderColor}30`,
                  }}
                >
                  <Activity size={14} />
                </button>
              </div>
            </div>
          )}

          {/* LiTTle-Bit Card */}
          {littleBit && (
            <div
              className="group rounded-3xl border p-6 relative overflow-hidden transition-all duration-300 hover:scale-[1.02]"
              style={{
                backgroundColor: T.boxBg + "90",
                borderColor: "#f9731630",
                backgroundImage: `linear-gradient(135deg, #f9731608 0%, transparent 100%)`,
              }}
            >
              {/* Status ring */}
              <div className="absolute top-4 right-4">
                <div className="relative">
                  <div
                    className="w-3 h-3 rounded-full animate-pulse"
                    style={{
                      backgroundColor: "#f97316",
                      boxShadow: `0 0 12px #f97316`,
                    }}
                  />
                  <div
                    className="absolute inset-0 w-3 h-3 rounded-full animate-ping"
                    style={{ backgroundColor: "#f97316" }}
                  />
                </div>
              </div>

              {/* Agent header */}
              <div className="flex items-start gap-4 mb-4">
                <div
                  className="w-16 h-16 rounded-2xl overflow-hidden relative flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, #f97316, #ea580c)`,
                    boxShadow: `0 0 20px #f9731640`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/brand/litt-mascot-hero.png"
                    alt="LiTTle-Bit"
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
                <div className="flex-1">
                  <h2
                    className="text-2xl font-black"
                    style={{ color: T.headerColor }}
                  >
                    LiTTle-Bit
                  </h2>
                  <p
                    className="text-sm font-bold uppercase tracking-wider"
                    style={{ color: "#f97316" }}
                  >
                    Director Agent
                  </p>
                  <p className="text-xs mt-1" style={{ color: T.textMuted }}>
                    Ready · Auto Router
                  </p>
                </div>
              </div>

              {/* Capabilities */}
              <div className="mb-4">
                <p
                  className="text-xs font-black uppercase tracking-wider mb-2"
                  style={{ color: T.textMuted }}
                >
                  Capabilities
                </p>
                <p className="text-sm" style={{ color: T.textColor }}>
                  Plans, researches, coordinates, creates
                </p>
              </div>

              {/* Current activity from real tasks */}
              <div className="mb-4">
                <p
                  className="text-xs font-black uppercase tracking-wider mb-2"
                  style={{ color: T.textMuted }}
                >
                  Current Activity
                </p>
                {(() => {
                  const active = activeTaskForAgent("littlebit");
                  if (!active) {
                    return (
                      <div
                        className="rounded-lg p-3 text-xs"
                        style={{
                          backgroundColor: "#f9731608",
                          border: "1px solid #f9731620",
                          color: T.textMuted,
                        }}
                      >
                        No active mission
                      </div>
                    );
                  }
                  return (
                    <div
                      className="rounded-lg p-3"
                      style={{
                        backgroundColor: "#f9731608",
                        border: `1px solid ${statusColor(active.status)}30`,
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold truncate max-w-[70%]">
                          {active.task_input?.title || active.task_input?.prompt || "Untitled mission"}
                        </span>
                        <span className="text-xs flex items-center gap-1" style={{ color: statusColor(active.status) }}>
                          {statusIcon(active.status)} {statusLabel(active.status)}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: T.textMuted }}>
                        {timeAgo(active.created_at)}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => router.push(`/studio?agent=littlebit`)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: "#f9731615",
                    color: "#f97316",
                    border: "1px solid #f9731630",
                  }}
                >
                  <Play size={14} /> Start Mission
                </button>
                <button
                  onClick={() => router.push(`/studio?agent=littlebit&configure=true`)}
                  className="px-3 py-2.5 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: T.bgColor + "60",
                    color: T.textColor,
                    border: `1px solid ${T.borderColor}30`,
                  }}
                >
                  <Settings size={14} />
                </button>
                <button
                  onClick={() => router.push(`/studio?agent=littlebit&activity=true`)}
                  className="px-3 py-2.5 rounded-xl text-sm font-black transition-all hover:opacity-90"
                  style={{
                    backgroundColor: T.bgColor + "60",
                    color: T.textColor,
                    border: `1px solid ${T.borderColor}30`,
                  }}
                >
                  <Activity size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Active Missions */}
      <section className="max-w-7xl mx-auto px-4 mt-8 relative z-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black" style={{ color: T.headerColor }}>
            Active Missions
          </h2>
          <Link
            href="/studio?missions=true"
            className="text-sm font-bold flex items-center gap-1"
            style={{ color: T.accentColor }}
          >
            View All <ChevronRight size={14} />
          </Link>
        </div>

        {loadState === "loading" && (
          <div
            className="rounded-2xl border p-8 text-center"
            style={{
              backgroundColor: T.boxBg + "40",
              borderColor: T.borderColor + "20",
            }}
          >
            <Loader2 size={24} className="mx-auto mb-3 animate-spin" style={{ color: T.accentColor }} />
            <p className="text-sm" style={{ color: T.textMuted }}>
              Loading missions…
            </p>
          </div>
        )}

        {loadState === "error" && (
          <div
            className="rounded-2xl border p-8 text-center"
            style={{
              backgroundColor: T.boxBg + "40",
              borderColor: "#ef444430",
            }}
          >
            <AlertCircle size={24} className="mx-auto mb-3" style={{ color: "#ef4444" }} />
            <h3 className="text-lg font-bold mb-2" style={{ color: T.headerColor }}>
              Could not load missions
            </h3>
            <p className="text-sm" style={{ color: T.textMuted }}>
              The backend may be unavailable. Try again in a moment.
            </p>
            <button
              onClick={fetchTasks}
              className="mt-4 px-4 py-2 rounded-xl text-sm font-bold"
              style={{
                backgroundColor: T.accentColor + "15",
                color: T.accentColor,
                border: `1px solid ${T.accentColor}30`,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {loadState === "loaded" && tasks.length === 0 && (
          <div
            className="rounded-2xl border p-8 text-center"
            style={{
              backgroundColor: T.boxBg + "40",
              borderColor: T.borderColor + "20",
            }}
          >
            <Target size={32} className="mx-auto mb-3" style={{ color: T.textMuted }} />
            <h3 className="text-lg font-bold mb-2" style={{ color: T.headerColor }}>
              No missions yet
            </h3>
            <p className="text-sm" style={{ color: T.textMuted }}>
              Give your crew an objective above and it will appear here.
            </p>
          </div>
        )}

        {loadState === "loaded" && tasks.length > 0 && (
          <div className="space-y-3">
            {tasks.map((task) => {
              const agent = getAgentForTask(task);
              const agentName = agent?.name || task.assigned_to;
              const agentColor = agent?.color || T.textMuted;
              const title = task.task_input?.title || task.task_input?.prompt || "Untitled mission";
              const desc = task.task_input?.prompt as string || "";
              return (
                <div
                  key={task.id}
                  className="rounded-2xl border p-4 cursor-pointer transition-all hover:scale-[1.01]"
                  style={{
                    backgroundColor: T.boxBg + "60",
                    borderColor: T.borderColor + "20",
                  }}
                  onClick={() =>
                    router.push(`/studio?agent=${task.assigned_to.toLowerCase()}&mission=${encodeURIComponent(title)}`)
                  }
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span style={{ color: statusColor(task.status) }}>
                        {statusIcon(task.status)}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold" style={{ color: T.textColor }}>
                          {title}
                        </h3>
                        <p className="text-xs" style={{ color: T.textMuted }}>
                          <span style={{ color: agentColor }}>{agentName}</span> • {timeAgo(task.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-bold flex items-center gap-1"
                        style={{ color: statusColor(task.status) }}
                      >
                        {statusLabel(task.status)}
                      </span>
                    </div>
                  </div>
                  {desc && desc !== title && (
                    <p className="text-xs" style={{ color: T.textMuted }}>
                      {desc}
                    </p>
                  )}
                  {task.status === "queued" && (
                    <p className="text-xs mt-1" style={{ color: statusColor(task.status) }}>
                      Waiting for agent worker to claim this mission
                    </p>
                  )}
                  {task.result_summary && (
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>
                      {task.result_summary}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* LiTT Character Sheet */}
      <section className="max-w-7xl mx-auto px-4 mt-8 relative z-10">
        <div
          className="rounded-3xl border p-6 relative overflow-hidden"
          style={{
            backgroundColor: T.boxBg + "60",
            borderColor: T.borderColor + "20",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <Sparkles size={18} style={{ color: T.accentColor }} />
            <h2 className="text-lg font-black" style={{ color: T.headerColor }}>
              LiTT Character Sheet
            </h2>
          </div>
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/litt-mascot-character-sheet.png"
              alt="LiTT mascot character sheet — three poses"
              style={{
                maxWidth: "100%",
                maxHeight: "400px",
                borderRadius: "16px",
                objectFit: "contain",
              }}
            />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-7xl mx-auto px-4 mt-12 mb-8 relative z-10">
        <div
          className="rounded-3xl border p-8 text-center"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}08, ${T.linkColor}06)`,
            borderColor: T.borderColor + "25",
          }}
        >
          <Sparkles
            size={24}
            className="mx-auto mb-3"
            style={{ color: T.accentColor }}
          />
          <h2
            className="text-xl font-black mb-3"
            style={{ color: T.headerColor }}
          >
            Ready to put your crew to work?
          </h2>
          <p
            className="text-sm mb-6 max-w-md mx-auto"
            style={{ color: T.textMuted }}
          >
            Start a mission and let LiTTle-Bit route the plan while LiTT-Code
            handles execution.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setCommand("")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all hover:opacity-90"
              style={{
                backgroundColor: T.accentColor,
                color: "#000",
              }}
            >
              <Zap size={16} /> Start Mission
            </button>
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black transition-all hover:opacity-90"
              style={{
                backgroundColor: T.boxBg + "60",
                color: T.textColor,
                border: `1px solid ${T.borderColor}30`,
              }}
            >
              Open Studio
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
