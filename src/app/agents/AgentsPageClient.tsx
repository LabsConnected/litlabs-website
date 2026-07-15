"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";

type StatusData = Record<string, { status: string; lastAction?: string }>;
type Mission = {
  id: string;
  title: string;
  agent: string;
  progress: number;
  status: "running" | "awaiting" | "blocked" | "completed";
  description: string;
  startedAt: string;
  estimatedTime?: string;
};

// Mock missions for demo
const MOCK_MISSIONS: Mission[] = [
  {
    id: "1",
    title: "Studio UI consolidation",
    agent: "LiTT-Code",
    progress: 68,
    status: "running",
    description: "Refactoring studio components for unified workspace",
    startedAt: "2 hours ago",
    estimatedTime: "45 min",
  },
  {
    id: "2",
    title: "Marketplace launch plan",
    agent: "LiTTle-Bit",
    progress: 92,
    status: "awaiting",
    description: "Preparing go-to-market strategy and assets",
    startedAt: "1 day ago",
    estimatedTime: "Approval pending",
  },
  {
    id: "3",
    title: "Mobile voice debugging",
    agent: "LiTT-Code",
    progress: 34,
    status: "blocked",
    description: "Investigating voice input issues on mobile devices",
    startedAt: "3 hours ago",
    estimatedTime: "Waiting for API access",
  },
];

// Agent routing logic
function routeTask(task: string): {
  agent: string;
  reason: string;
  directed?: string;
} {
  const lower = task.toLowerCase();

  // Engineering tasks
  if (
    lower.includes("fix") ||
    lower.includes("debug") ||
    lower.includes("code") ||
    lower.includes("build") ||
    lower.includes("deploy") ||
    lower.includes("test") ||
    lower.includes("mobile") ||
    lower.includes("navigation") ||
    lower.includes("ui")
  ) {
    return {
      agent: "LiTT-Code",
      reason: "Engineering, debugging, and implementation required",
    };
  }

  // Director tasks
  if (
    lower.includes("plan") ||
    lower.includes("strategy") ||
    lower.includes("launch") ||
    lower.includes("market") ||
    lower.includes("coordinate") ||
    lower.includes("research")
  ) {
    return {
      agent: "LiTTle-Bit",
      reason: "Strategic planning and coordination required",
    };
  }

  // Complex tasks requiring both
  if (
    lower.includes("create") ||
    lower.includes("build") ||
    lower.includes("develop")
  ) {
    return {
      agent: "LiTTle-Bit",
      reason: "Complex project requiring planning and execution",
      directed: "LiTT-Code",
    };
  }

  // Default to director for unknown tasks
  return {
    agent: "LiTTle-Bit",
    reason: "Task analysis and routing required",
  };
}

export default function AgentsPageClient() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const [, setStatusData] = useState<StatusData>({});
  const [, setLoading] = useState(true);
  const [command, setCommand] = useState("");
  const [routing, setRouting] = useState<{
    agent: string;
    reason: string;
    directed?: string;
  } | null>(null);
  const [missions] = useState<Mission[]>(MOCK_MISSIONS);

  const agents = Object.values(AGENTS).filter((a) => a.id !== "pixel-forge");
  // IDs in src/lib/agents.ts are "littcode" and "littlebit" (no hyphens)
  const littCode = agents.find((a) => a.id === "littcode");
  const littleBit = agents.find((a) => a.id === "littlebit");

  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/agents/status");
        const data = await res.json();
        if (alive) {
          setStatusData(data.agents || data);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const handleCommandSubmit = () => {
    if (!command.trim()) return;

    const route = routeTask(command);
    setRouting(route);

    // Auto-redirect after showing routing
    setTimeout(() => {
      if (route.directed) {
        // Go to studio with both agents context
        router.push(
          `/studio?tool=chat&mission=${encodeURIComponent(command)}&director=${route.agent}&executor=${route.directed}`,
        );
      } else {
        // Go to specific agent
        router.push(
          `/studio?tool=chat&mission=${encodeURIComponent(command)}&agent=${route.agent}`,
        );
      }
    }, 2000);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "#22d3ee";
      case "awaiting":
        return "#f59e0b";
      case "blocked":
        return "#ef4444";
      case "completed":
        return "#10b981";
      default:
        return "#34d399";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Activity size={12} />;
      case "awaiting":
        return <Clock size={12} />;
      case "blocked":
        return <AlertCircle size={12} />;
      case "completed":
        return <CheckCircle size={12} />;
      default:
        return <CheckCircle size={12} />;
    }
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
                  href="/studio?tool=agents"
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
                  Assigned to {routing.agent}
                </span>
                <span className="text-xs" style={{ color: T.textMuted }}>
                  • {routing.reason}
                </span>
                {routing.directed && (
                  <span className="text-xs" style={{ color: T.linkColor }}>
                    → Execution by {routing.directed}
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

              {/* Current mission */}
              <div className="mb-4">
                <p
                  className="text-xs font-black uppercase tracking-wider mb-2"
                  style={{ color: T.textMuted }}
                >
                  Current Mission
                </p>
                <div
                  className="rounded-lg p-3"
                  style={{
                    backgroundColor: "#22d3ee08",
                    border: "1px solid #22d3ee20",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">
                      Studio UI consolidation
                    </span>
                    <span className="text-xs" style={{ color: "#22d3ee" }}>
                      68%
                    </span>
                  </div>
                  <div
                    className="w-full h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: "#22d3ee20" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: "68%", backgroundColor: "#22d3ee" }}
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    router.push(`/studio?tool=chat&agent=LiTT-Code`)
                  }
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
                  onClick={() =>
                    router.push(
                      `/studio?tool=chat&agent=LiTT-Code&configure=true`,
                    )
                  }
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
                  onClick={() =>
                    router.push(
                      `/studio?tool=chat&agent=LiTT-Code&activity=true`,
                    )
                  }
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
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, #f97316, #ea580c)`,
                    boxShadow: `0 0 20px #f9731640`,
                  }}
                >
                  <Brain size={28} className="text-white" />
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

              {/* Current mission */}
              <div className="mb-4">
                <p
                  className="text-xs font-black uppercase tracking-wider mb-2"
                  style={{ color: T.textMuted }}
                >
                  Current Mission
                </p>
                <div
                  className="rounded-lg p-3"
                  style={{
                    backgroundColor: "#f9731608",
                    border: "1px solid #f9731620",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">
                      Marketplace launch plan
                    </span>
                    <span className="text-xs" style={{ color: "#f97316" }}>
                      92%
                    </span>
                  </div>
                  <div
                    className="w-full h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: "#f9731620" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: "92%", backgroundColor: "#f97316" }}
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    router.push(`/studio?tool=chat&agent=LiTTle-Bit`)
                  }
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
                  onClick={() =>
                    router.push(
                      `/studio?tool=chat&agent=LiTTle-Bit&configure=true`,
                    )
                  }
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
                  onClick={() =>
                    router.push(
                      `/studio?tool=chat&agent=LiTTle-Bit&activity=true`,
                    )
                  }
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
            href="/studio?tool=chat&missions=true"
            className="text-sm font-bold flex items-center gap-1"
            style={{ color: T.accentColor }}
          >
            View All <ChevronRight size={14} />
          </Link>
        </div>

        {missions.length > 0 ? (
          <div className="space-y-3">
            {missions.map((mission) => (
              <div
                key={mission.id}
                className="rounded-2xl border p-4 cursor-pointer transition-all hover:scale-[1.01]"
                style={{
                  backgroundColor: T.boxBg + "60",
                  borderColor: T.borderColor + "20",
                }}
                onClick={() =>
                  router.push(`/studio?tool=chat&mission=${mission.id}`)
                }
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(mission.status)}
                    <div>
                      <h3
                        className="text-sm font-bold"
                        style={{ color: T.textColor }}
                      >
                        {mission.title}
                      </h3>
                      <p className="text-xs" style={{ color: T.textMuted }}>
                        {mission.agent} • {mission.startedAt}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-bold"
                      style={{ color: getStatusColor(mission.status) }}
                    >
                      {mission.progress}%
                    </span>
                    <div
                      className="w-16 h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: T.borderColor + "20" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${mission.progress}%`,
                          backgroundColor: getStatusColor(mission.status),
                        }}
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs" style={{ color: T.textMuted }}>
                  {mission.description}
                </p>
                {mission.estimatedTime && (
                  <p
                    className="text-xs mt-1"
                    style={{ color: getStatusColor(mission.status) }}
                  >
                    ETA: {mission.estimatedTime}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="rounded-2xl border p-8 text-center"
            style={{
              backgroundColor: T.boxBg + "40",
              borderColor: T.borderColor + "20",
            }}
          >
            <Target
              size={32}
              className="mx-auto mb-3"
              style={{ color: T.textMuted }}
            />
            <h3
              className="text-lg font-bold mb-2"
              style={{ color: T.headerColor }}
            >
              No missions running
            </h3>
            <p className="text-sm" style={{ color: T.textMuted }}>
              Give your crew an objective and they will plan, execute, verify,
              and report back.
            </p>
          </div>
        )}
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
