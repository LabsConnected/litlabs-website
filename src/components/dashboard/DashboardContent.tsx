"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  GitBranch,
  ImageIcon,
  Loader2,
  PlugZap,
  RefreshCw,
  Rocket,
  Wallet,
  Zap,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

type DailyUsage = {
  date: string;
  commands: number;
  agentTasks: number;
  generations: number;
};

type WorkspacePulse = {
  projects: number;
  agents: number;
  deployments: number;
  liveDeployments: number;
  balance: number | null;
  plan: string;
  tasksCompleted: number;
  generations: number;
  commands: number;
  daily: DailyUsage[];
  sources: {
    github: boolean;
    agents: boolean;
    deployments: boolean;
    wallet: boolean;
    usage: boolean;
  };
  updatedAt: string;
};

const EMPTY: WorkspacePulse = {
  projects: 0,
  agents: 0,
  deployments: 0,
  liveDeployments: 0,
  balance: null,
  plan: "Free",
  tasksCompleted: 0,
  generations: 0,
  commands: 0,
  daily: [],
  sources: { github: false, agents: false, deployments: false, wallet: false, usage: false },
  updatedAt: "",
};

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

export default function DashboardContent() {
  const { resolvedColors: T } = useTheme();
  const [pulse, setPulse] = useState<WorkspacePulse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      readJson("/api/projects"),
      readJson("/api/user-agents"),
      readJson("/api/deployments?limit=100"),
      readJson("/api/wallet"),
      readJson("/api/usage/stats"),
    ]);
    const [projectsResult, agentsResult, deploymentsResult, walletResult, usageResult] = results;
    const projects = projectsResult.status === "fulfilled" ? projectsResult.value.projects ?? [] : [];
    const agents = agentsResult.status === "fulfilled" ? agentsResult.value.agents ?? [] : [];
    const deployments = deploymentsResult.status === "fulfilled" ? deploymentsResult.value.deployments ?? [] : [];
    const wallet = walletResult.status === "fulfilled" ? walletResult.value : null;
    const usage = usageResult.status === "fulfilled" && !usageResult.value.demo ? usageResult.value : null;

    setPulse({
      projects: projects.length,
      agents: agents.length,
      deployments: deployments.length,
      liveDeployments: deployments.filter((item: { status?: string }) => item.status === "live").length,
      balance: typeof wallet?.balance === "number" ? wallet.balance : null,
      plan: usage?.summary?.plan ?? wallet?.plan ?? "Free",
      tasksCompleted: usage?.summary?.totalAgentTasks ?? 0,
      generations: usage?.summary?.totalGenerations ?? 0,
      commands: usage?.summary?.totalCommands ?? 0,
      daily: usage?.daily ?? [],
      sources: {
        github: projectsResult.status === "fulfilled",
        agents: agentsResult.status === "fulfilled",
        deployments: deploymentsResult.status === "fulfilled",
        wallet: walletResult.status === "fulfilled",
        usage: Boolean(usage),
      },
      updatedAt: new Date().toISOString(),
    });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const maxDay = useMemo(
    () => Math.max(1, ...pulse.daily.map((day) => day.commands + day.agentTasks + day.generations)),
    [pulse.daily],
  );

  const stats = [
    { label: "Active projects", value: pulse.projects, icon: GitBranch, color: "#60a5fa", ready: pulse.sources.github },
    { label: "Installed agents", value: pulse.agents, icon: Bot, color: "#a78bfa", ready: pulse.sources.agents },
    { label: "Tasks completed", value: pulse.tasksCompleted, icon: CheckCircle2, color: "#34d399", ready: pulse.sources.usage },
    { label: "Live deployments", value: pulse.liveDeployments, icon: Rocket, color: "#fb7185", ready: pulse.sources.deployments },
    { label: "Assets generated", value: pulse.generations, icon: ImageIcon, color: "#f472b6", ready: pulse.sources.usage },
    { label: "Commands run", value: pulse.commands, icon: Code2, color: "#22d3ee", ready: pulse.sources.usage },
  ];

  const connections = [
    { name: "GitHub", detail: pulse.sources.github ? `${pulse.projects} connected project${pulse.projects === 1 ? "" : "s"}` : "Connection unavailable", connected: pulse.projects > 0, available: pulse.sources.github, icon: GitBranch, href: "/projects" },
    { name: "Agent runtime", detail: pulse.sources.agents ? `${pulse.agents} installed agent${pulse.agents === 1 ? "" : "s"}` : "Connection unavailable", connected: pulse.agents > 0, available: pulse.sources.agents, icon: Bot, href: "/agents" },
    { name: "Deployments", detail: pulse.sources.deployments ? `${pulse.deployments} deployment record${pulse.deployments === 1 ? "" : "s"}` : "Connection unavailable", connected: pulse.deployments > 0, available: pulse.sources.deployments, icon: Cloud, href: "/deployments" },
    { name: "Workspace data", detail: pulse.sources.usage ? "Live 14-day activity connected" : "Reconnect usage data", connected: pulse.sources.usage, available: true, icon: Database, href: "/settings" },
  ];

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="rounded-2xl border p-5" style={{ background: `linear-gradient(135deg, ${T.accentColor}16, ${T.boxBg})`, borderColor: `${T.accentColor}35` }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>Workspace pulse</p>
              <h2 className="mt-2 text-xl font-black" style={{ color: T.headerColor }}>Your connected work, in one place.</h2>
              <p className="mt-1 max-w-xl text-xs leading-5" style={{ color: T.textMuted }}>Counts refresh every minute from the services already connected to LiTT. Empty and unavailable data stays honest.</p>
            </div>
            <button onClick={() => void refresh()} disabled={refreshing} className="rounded-xl border p-2.5 transition hover:opacity-80 disabled:opacity-40" style={{ borderColor: `${T.borderColor}40`, color: T.textMuted }} aria-label="Refresh dashboard">
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-[10px]" style={{ color: T.textMuted }}>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Auto-refresh on</span>
            {pulse.updatedAt && <span>Updated {new Date(pulse.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}>
          <Link href="/wallet" className="flex items-center gap-3 border-b p-4 transition hover:opacity-80" style={{ borderColor: `${T.borderColor}25` }}>
            <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: "#fbbf2415" }}><Wallet size={17} style={{ color: "#fbbf24" }} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-wider" style={{ color: T.textMuted }}>Credit balance · {pulse.plan}</span><strong className="mt-0.5 block text-lg" style={{ color: T.headerColor }}>{loading ? "—" : pulse.balance === null ? "Unavailable" : `${pulse.balance.toLocaleString()} LBC`}</strong></span>
            <ArrowRight size={14} className="opacity-30" />
          </Link>
          <Link href="/settings" className="flex items-center gap-3 p-4 transition hover:opacity-80">
            <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `${T.accentColor}15` }}><PlugZap size={17} style={{ color: T.accentColor }} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-wider" style={{ color: T.textMuted }}>Data sources active</span><strong className="mt-0.5 block text-lg" style={{ color: T.headerColor }}>{connections.filter((item) => item.connected).length}/{connections.length}</strong></span>
            <ArrowRight size={14} className="opacity-30" />
          </Link>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}25` }}>
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 border-b p-3.5 last:border-b-0" style={{ borderColor: `${T.borderColor}20` }}>
            <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ backgroundColor: `${stat.color}12` }}><stat.icon size={15} style={{ color: stat.color }} /></span>
            <div className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>{stat.label}</div>
            <div className="text-lg font-black" style={{ color: T.headerColor }}>{loading ? "—" : stat.ready ? stat.value.toLocaleString() : "—"}</div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}25` }}>
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-black" style={{ color: T.headerColor }}>Seven-day performance</h3><p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>Commands, agent tasks, and generations</p></div>
            <Activity size={16} style={{ color: T.accentColor }} />
          </div>
          {pulse.sources.usage ? (
            <div className="mt-5 flex h-28 items-end gap-2 sm:mt-6 sm:h-40">
              {pulse.daily.slice(-7).map((day) => {
                const total = day.commands + day.agentTasks + day.generations;
                return <div key={day.date} className="flex h-full flex-1 flex-col justify-end gap-2"><div className="min-h-1 rounded-t-md transition-all" title={`${total} events`} style={{ height: `${Math.max(4, (total / maxDay) * 100)}%`, background: `linear-gradient(180deg, ${T.accentColor}, ${T.linkColor})` }} /><span className="text-center text-[9px]" style={{ color: T.textMuted }}>{new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "narrow" })}</span></div>;
              })}
            </div>
          ) : (
            <div className="mt-5 flex h-28 flex-col items-center justify-center rounded-xl border border-dashed sm:mt-6 sm:h-40" style={{ borderColor: `${T.borderColor}35`, color: T.textMuted }}><Activity size={20} className="mb-2 opacity-50" /><p className="text-xs font-bold">Usage data is not connected</p><Link href="/settings" className="mt-2 text-[10px]" style={{ color: T.accentColor }}>Review connection <ArrowRight size={10} className="inline" /></Link></div>
          )}
        </div>

        <div className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}25` }}>
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-black" style={{ color: T.headerColor }}>Connected software</h3><p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>Live status from your workspace</p></div><Boxes size={16} style={{ color: T.accentColor }} /></div>
          <div className="mt-4 space-y-2">
            {connections.map((connection) => (
              <Link key={connection.name} href={connection.href} className="flex items-center gap-3 rounded-xl border p-3 transition hover:opacity-80" style={{ borderColor: `${T.borderColor}20`, backgroundColor: `${T.bgColor}55` }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${T.accentColor}12` }}><connection.icon size={15} style={{ color: T.accentColor }} /></div>
                <div className="min-w-0 flex-1"><div className="text-xs font-bold" style={{ color: T.headerColor }}>{connection.name}</div><div className="truncate text-[9px]" style={{ color: T.textMuted }}>{connection.detail}</div></div>
                <span className={`h-2 w-2 rounded-full ${connection.connected ? "bg-emerald-400" : connection.available ? "bg-amber-400" : "bg-rose-400"}`} />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        {[
          { label: "Open Studio", href: "/studio", icon: Zap, detail: "Create with LiTT" },
          { label: "Connect project", href: "/projects", icon: GitBranch, detail: "Add a GitHub repository" },
          { label: "Create agent", href: "/agents", icon: Bot, detail: "Build or install an agent" },
          { label: "View deployments", href: "/deployments", icon: Rocket, detail: "Track releases" },
        ].map((action) => <Link key={action.label} href={action.href} className="group flex items-center gap-3 rounded-xl border p-4 transition hover:-translate-y-0.5" style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}25` }}><action.icon size={16} style={{ color: T.accentColor }} /><div className="flex-1"><div className="text-xs font-black" style={{ color: T.headerColor }}>{action.label}</div><div className="text-[9px]" style={{ color: T.textMuted }}>{action.detail}</div></div><ArrowRight size={13} className="opacity-30 transition group-hover:translate-x-1" /></Link>)}
      </section>

      {loading && <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/10 pointer-events-none"><Loader2 className="animate-spin" style={{ color: T.accentColor }} /></div>}
    </div>
  );
}
