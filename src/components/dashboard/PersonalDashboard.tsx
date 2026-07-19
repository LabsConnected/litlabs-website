"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Coins,
  FolderKanban,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Plus,
  Rocket,
  Send,
  Sparkles,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

type Project = {
  id: string;
  owner: string;
  repository: string;
  status: string;
  updated_at: string;
  working_branch?: string;
};
type Task = {
  id: string;
  status: string;
  input?: string;
  error?: string;
  result?: Record<string, unknown>;
  created_at: string;
  completed_at?: string;
  agent?: { display_name?: string; slug?: string; role?: string } | null;
};
type Agent = {
  id: string;
  is_active: boolean;
  installed_at?: string;
  agent?: { display_name?: string; slug?: string; role?: string } | null;
};
type Deployment = {
  id: string;
  branch: string;
  environment: string;
  status: string;
  deploy_url?: string;
  created_at: string;
};
type Media = { id: string; type: string; caption?: string; created_at: string };
type CommandData = {
  projects: Project[];
  tasks: Task[];
  agents: Agent[];
  deployments: Deployment[];
  media: Media[];
  connected: boolean;
  partial: boolean;
  failedSources?: string[];
};
type UsageData = {
  summary?: {
    totalCommands?: number;
    totalAgentTasks?: number;
    totalGenerations?: number;
    hourlyUsed?: number;
    hourlyLimit?: number;
    plan?: string;
  };
  daily?: {
    date: string;
    commands: number;
    agentTasks: number;
    generations: number;
  }[];
  demo?: boolean;
  partial?: boolean;
};

function formatAgo(value?: string) {
  if (!value) return "Recently";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export default function PersonalDashboard({
  displayName,
}: {
  displayName: string;
}) {
  const { resolvedColors: T } = useTheme();
  const [data, setData] = useState<CommandData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/dashboard/command-center").then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch("/api/usage/stats").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/wallet").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([commandData, usageData, walletData]) => {
        if (!active) return;
        setData(commandData);
        setUsage(usageData);
        setBalance(
          typeof walletData?.balance === "number" ? walletData.balance : null,
        );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const activeTasks = useMemo(
    () =>
      data?.tasks.filter((task) =>
        ["running", "queued", "processing"].includes(task.status),
      ) ?? [],
    [data?.tasks],
  );
  const failedTasks = useMemo(
    () => data?.tasks.filter((task) => task.status === "failed") ?? [],
    [data?.tasks],
  );
  const completedTasks = useMemo(
    () =>
      data?.tasks.filter((task) =>
        ["completed", "success"].includes(task.status),
      ) ?? [],
    [data?.tasks],
  );
  const failedDeployments = useMemo(
    () => data?.deployments.filter((item) => item.status === "failed") ?? [],
    [data?.deployments],
  );
  const pendingDeployments = useMemo(
    () =>
      data?.deployments.filter((item) =>
        ["queued", "building", "deploying"].includes(item.status),
      ) ?? [],
    [data?.deployments],
  );
  const chartData = usage?.demo ? [] : (usage?.daily ?? []).slice(-7);
  const maxChart = Math.max(
    1,
    ...chartData.map((day) => day.commands + day.agentTasks + day.generations),
  );
  const timeSaved = completedTasks.length * 15 + (data?.media.length ?? 0) * 5;

  const attention = useMemo(() => {
    const items: { label: string; href: string; tone: string }[] = [];
    failedTasks.forEach((task) =>
      items.push({
        label:
          task.error || `${task.agent?.display_name || "Agent"} task failed`,
        href: "/studio",
        tone: "#fb7185",
      }),
    );
    failedDeployments.forEach((deploy) =>
      items.push({
        label: `Deployment failed: ${deploy.branch}`,
        href: "/deployments",
        tone: "#fb7185",
      }),
    );
    if (!data?.projects.length)
      items.push({
        label: "Connect your first GitHub project",
        href: "/studio/github",
        tone: "#fbbf24",
      });
    if (!data?.agents.length)
      items.push({
        label: "Create or install your first agent",
        href: "/agents",
        tone: "#c084fc",
      });
    if (balance !== null && balance < 100)
      items.push({
        label: "Credits are running low",
        href: "/wallet",
        tone: "#fbbf24",
      });
    if (data?.partial || usage?.partial)
      items.push({
        label: "Some workspace data needs reconnection",
        href: "/settings",
        tone: "#38bdf8",
      });
    return items.slice(0, 5);
  }, [balance, data, failedDeployments, failedTasks, usage]);

  const panel = "rounded-2xl border border-white/10 bg-white/[.035]";
  const recentProject = data?.projects[0];

  if (loading)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="animate-spin text-cyan-300" />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-8">
      <header className={`${panel} overflow-hidden p-5 sm:p-7`}>
        <p className="text-xs font-black uppercase tracking-[.18em] text-cyan-300">
          Personal command center
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-4xl">
          Welcome back, {displayName}
        </h1>
        <p className="mt-1 text-sm" style={{ color: T.textMuted }}>
          Own the work. Direct the agents. Ship what matters.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-300">
              <Coins size={14} />
              LBC Balance
            </div>
            <div className="text-3xl font-black text-white">
              {balance ?? "—"} <span className="text-sm">LBC</span>
            </div>
            <Link
              href="/wallet"
              className="text-xs font-bold text-amber-300 hover:underline"
            >
              Manage credits
            </Link>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/3 p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-300">
              <Gauge size={14} />
              Workspace status
            </div>
            <div className="text-lg font-black text-white">
              {data?.partial ? "Check data" : "Healthy"}
            </div>
            <Link
              href="/settings"
              className="text-xs font-bold text-emerald-300 hover:underline"
            >
              {data?.partial ? "Review connections" : "View settings"}
            </Link>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Open Studio", href: "/studio", icon: Sparkles },
            { label: "New Project", href: "/studio/github", icon: Plus },
            { label: "Create Agent", href: "/agents", icon: Bot },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/3 text-[10px] font-black transition hover:bg-white/6 sm:text-xs"
            >
              <item.icon size={14} />
              {item.label}
            </Link>
          ))}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${panel} p-4 sm:p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">Continue working</h2>
            <Link
              href="/projects"
              className="text-[10px] font-bold text-cyan-300"
            >
              All projects
            </Link>
          </div>
          {recentProject ? (
            <Link
              href="/projects"
              className="mt-4 grid grid-cols-[42px_1fr_18px] items-center gap-3 rounded-xl border border-white/8 bg-black/20 p-3"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300/15 text-cyan-300">
                <FolderKanban size={18} />
              </span>
              <span>
                <b className="block text-sm">
                  {recentProject.owner}/{recentProject.repository}
                </b>
                <small style={{ color: T.textMuted }}>
                  {recentProject.status} · {formatAgo(recentProject.updated_at)}
                </small>
              </span>
              <ArrowRight size={15} />
            </Link>
          ) : (
            <Empty
              label="No projects yet"
              action="Connect project"
              href="/studio/github"
            />
          )}
          {pendingDeployments[0] && (
            <Link
              href="/deployments"
              className="mt-2 flex items-center justify-between rounded-xl border border-white/8 p-3 text-xs"
            >
              <span>
                <Rocket size={14} className="mr-2 inline text-violet-300" />
                {pendingDeployments[0].branch}
              </span>
              <span className="text-amber-300">
                {pendingDeployments[0].status}
              </span>
            </Link>
          )}
        </section>

        <section className={`${panel} p-4 sm:p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">Needs attention</h2>
            <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[9px] font-black text-amber-300">
              {attention.length}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {attention.length ? (
              attention.map((item, index) => (
                <Link
                  key={`${item.label}-${index}`}
                  href={item.href}
                  className="flex items-center justify-between rounded-xl border border-white/8 p-3 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle size={14} style={{ color: item.tone }} />
                    {item.label}
                  </span>
                  <ArrowRight size={13} />
                </Link>
              ))
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-400/8 p-3 text-xs text-emerald-300">
                <CheckCircle2 size={15} />
                Nothing needs attention right now.
              </div>
            )}
          </div>
        </section>

        <section className={`${panel} p-4 sm:p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">Active agents</h2>
            <Link
              href="/agents"
              className="text-[10px] font-bold text-cyan-300"
            >
              Manage
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {activeTasks.length ? (
              activeTasks.slice(0, 4).map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-white/8 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black">
                      {task.agent?.display_name || "LiTT Agent"}
                    </span>
                    <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                      {task.status}
                    </span>
                  </div>
                  <p
                    className="mt-1 truncate text-[10px]"
                    style={{ color: T.textMuted }}
                  >
                    {task.input || "Working on assigned task"}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Link
                      href="/studio"
                      className="rounded-lg bg-white/5 px-2 py-1 text-[9px] font-bold"
                    >
                      Review
                    </Link>
                    <Link
                      href="/studio"
                      className="rounded-lg bg-cyan-400/10 px-2 py-1 text-[9px] font-bold text-cyan-300"
                    >
                      Open in Studio
                    </Link>
                  </div>
                </div>
              ))
            ) : data?.agents.length ? (
              data.agents.slice(0, 4).map((entry) => (
                <Link
                  key={entry.id}
                  href="/studio"
                  className="flex items-center justify-between rounded-xl border border-white/8 p-3"
                >
                  <span>
                    <b className="block text-xs">
                      {entry.agent?.display_name || "Installed agent"}
                    </b>
                    <small style={{ color: T.textMuted }}>
                      {entry.agent?.role || "Ready for work"}
                    </small>
                  </span>
                  <span className="text-[9px] font-bold text-slate-400">
                    Idle
                  </span>
                </Link>
              ))
            ) : (
              <Empty
                label="No agents installed"
                action="Browse agents"
                href="/agents"
              />
            )}
          </div>
        </section>

        <section className={`${panel} p-4 sm:p-5`}>
          <h2 className="text-sm font-black">Quick actions</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              {
                label: "Generate image",
                href: "/studio",
                icon: ImageIcon,
              },
              { label: "Run an agent", href: "/studio", icon: Bot },
              { label: "Open projects", href: "/projects", icon: FolderKanban },
              { label: "Deployments", href: "/deployments", icon: Rocket },
              { label: "Facebook post", href: "/facebook", icon: Send },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-white/8 bg-black/15 p-3 text-xs font-bold"
              >
                <item.icon size={16} className="text-cyan-300" />
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className={`${panel} p-4 sm:p-5`}>
        <h2 className="text-sm font-black">Workspace stats</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[
            [
              "Active projects",
              data?.projects.filter((p) => p.status !== "offline").length ?? 0,
              "/projects",
            ],
            ["Running agents", activeTasks.length, "/studio"],
            ["Tasks completed", completedTasks.length, "/studio"],
            ["Credits", balance ?? "—", "/wallet"],
            ["Deployments", data?.deployments.length ?? 0, "/deployments"],
            ["Assets", data?.media.length ?? 0, "/gallery"],
            ["Storage", "View", "/gallery"],
            ["Time saved", `${timeSaved}m`, "/studio"],
          ].map(([label, value, href]) => (
            <Link
              key={label}
              href={String(href)}
              className="rounded-xl border border-white/8 bg-black/15 p-3"
            >
              <b className="block text-lg">{value}</b>
              <small
                className="mt-1 block text-[9px] uppercase tracking-wide"
                style={{ color: T.textMuted }}
              >
                {label}
              </small>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <section className={`${panel} p-4 sm:p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">Seven-day performance</h2>
            <span className="text-[9px]" style={{ color: T.textMuted }}>
              {usage?.demo
                ? "Waiting for live usage data"
                : usage?.summary?.plan || "Current plan"}
            </span>
          </div>
          {chartData.length ? (
            <div className="mt-5 flex h-40 items-end gap-2">
              {chartData.map((day) => {
                const total = day.commands + day.agentTasks + day.generations;
                return (
                  <div
                    key={day.date}
                    className="flex h-full flex-1 flex-col justify-end gap-1"
                  >
                    <div
                      className="rounded-t-md bg-linear-to-t from-violet-600 to-cyan-300"
                      style={{
                        height: `${Math.max(4, (total / maxChart) * 100)}%`,
                      }}
                      title={`${total} actions`}
                    />
                    <span
                      className="text-center text-[8px]"
                      style={{ color: T.textMuted }}
                    >
                      {new Date(`${day.date}T12:00:00`).toLocaleDateString(
                        undefined,
                        { weekday: "narrow" },
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              label="Performance appears after real tasks and generations"
              action="Start creating"
              href="/studio"
            />
          )}
        </section>
        <section className={`${panel} p-4 sm:p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">Recent activity</h2>
            <Activity size={15} className="text-cyan-300" />
          </div>
          <div className="mt-3 space-y-3">
            {[
              ...completedTasks.map((task) => ({
                id: task.id,
                label: `${task.agent?.display_name || "Agent"} completed a task`,
                time: task.completed_at || task.created_at,
                href: "/studio",
              })),
              ...(data?.media.map((item) => ({
                id: item.id,
                label: `${item.type} created${item.caption ? `: ${item.caption}` : ""}`,
                time: item.created_at,
                href: "/gallery",
              })) ?? []),
              ...(data?.deployments.map((item) => ({
                id: item.id,
                label: `${item.environment} deployment ${item.status}`,
                time: item.created_at,
                href: "/deployments",
              })) ?? []),
            ]
              .sort(
                (a, b) =>
                  new Date(b.time).getTime() - new Date(a.time).getTime(),
              )
              .slice(0, 6)
              .map((event) => (
                <Link
                  key={`${event.id}-${event.href}`}
                  href={event.href}
                  className="flex items-center gap-3 text-xs"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
                  <span className="min-w-0 flex-1 truncate">{event.label}</span>
                  <time className="text-[9px]" style={{ color: T.textMuted }}>
                    {formatAgo(event.time)}
                  </time>
                </Link>
              ))}
            {!completedTasks.length &&
              !data?.media.length &&
              !data?.deployments.length && (
                <Empty
                  label="Your real workspace events will appear here"
                  action="Open Studio"
                  href="/studio"
                />
              )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Empty({
  label,
  action,
  href,
}: {
  label: string;
  action: string;
  href: string;
}) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-white/10 p-4 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <Link
        href={href}
        className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-cyan-300"
      >
        {action}
        <ArrowRight size={11} />
      </Link>
    </div>
  );
}
