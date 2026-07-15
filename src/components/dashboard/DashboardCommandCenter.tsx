"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import {
  Zap,
  Plus,
  Bot,
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Image as ImageIcon,
  Film,
  Music,
  FileCode,
  ArrowRight,
  Coins,
  Rocket,
  Box,
  ExternalLink,
  Send,
  RefreshCw,
} from "lucide-react";

export type CommandCenterData = {
  user: {
    id: string;
    name: string;
    username: string | null;
    avatarUrl: string | null;
    createdAt: string;
  };
  stats: {
    activeProjects: number;
    installedAgents: number;
    runningTasks: number;
    tasksCompletedToday: number;
    tasksCompletedWeek: number;
    failedTasks: number;
    credits: number;
    deployments: number;
    successfulDeployments: number;
    failedDeployments: number;
    generatedAssets: number;
    posts: number;
    storageUsedMB: number;
  };
  agents: Array<{
    id: string;
    slug: string;
    name: string;
    role: string;
    description: string;
    installedAt: string;
  }>;
  tasks: Array<{
    id: string;
    type: string | null;
    input: string;
    status: string;
    error: string | null;
    createdAt: string;
    completedAt: string | null;
    agent: { id: string; slug: string; name: string };
  }>;
  continueWorking: {
    conversations: Array<{
      id: string;
      agentId: string;
      title: string;
      updatedAt: string;
      createdAt: string;
    }>;
    media: Array<{
      id: string;
      type: string;
      url: string;
      caption: string;
      createdAt: string;
    }>;
    posts: Array<{
      id: string;
      content: string;
      createdAt: string;
      likes: number;
      comments: number;
    }>;
  };
  deployments: Array<{
    id: string;
    status: string;
    environment: string;
    branch: string;
    createdAt: string;
    updatedAt: string;
  }>;
  attention: Array<{
    id: string;
    type: string;
    message: string;
    action?: string;
    href?: string;
  }>;
};

const typeIcon = (type?: string | null) => {
  switch (type) {
    case "image":
      return ImageIcon;
    case "video":
      return Film;
    case "audio":
      return Music;
    case "code":
      return FileCode;
    default:
      return Zap;
  }
};

function SectionHeader({
  title,
  action,
  href,
}: {
  title: string;
  action?: string;
  href?: string;
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3
        className="text-[10px] font-black uppercase tracking-[0.18em]"
        style={{ color: T.textMuted }}
      >
        {title}
      </h3>
      {action && href && (
        <Link
          href={href}
          className="text-[10px] font-bold flex items-center gap-0.5 transition hover:opacity-70"
          style={{ color: T.accentColor }}
        >
          {action} <ArrowRight size={10} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "running"
      ? "#38bdf8"
      : status === "completed" || status === "live"
        ? "#22c55e"
        : status === "failed"
          ? "#ef4444"
          : status === "paused"
            ? "#f59e0b"
            : "#a1a1aa";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{
        color,
        backgroundColor: `${color}15`,
        border: `1px solid ${color}30`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {status}
    </span>
  );
}

export default function DashboardCommandCenter() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const { refresh: refreshWallet } = useWallet();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard/command-center", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load dashboard");
      const json = (await res.json()) as CommandCenterData;
      setData(json);
      setError(null);
      refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16"
        style={{ color: T.textMuted }}
      >
        <Loader2 size={24} className="animate-spin" aria-hidden="true" />
        <span className="mt-3 text-xs font-bold uppercase tracking-widest">
          Loading command center…
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="rounded-2xl border p-5 text-center"
        style={{ borderColor: T.borderColor + "25", backgroundColor: T.boxBg }}
      >
        <div className="mb-2 flex justify-center">
          <AlertCircle
            size={24}
            style={{ color: "#ef4444" }}
            aria-hidden="true"
          />
        </div>
        <p className="text-sm font-bold" style={{ color: T.textColor }}>
          Couldn’t load your dashboard.
        </p>
        <p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>
          {error}
        </p>
        <button
          onClick={() => void fetchData()}
          className="mt-3 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold transition hover:opacity-80"
          style={{ backgroundColor: T.accentColor, color: T.bgColor }}
        >
          <RefreshCw size={10} aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  const {
    user,
    stats,
    agents,
    tasks,
    continueWorking,
    deployments,
    attention,
  } = data;
  const displayName = user.name || user.username || "Creator";

  const quickActions = [
    { label: "Open Studio", icon: Zap, href: "/studio", color: "#8b5cf6" },
    { label: "New Project", icon: Plus, href: "/projects", color: "#00f0ff" },
    { label: "Create Agent", icon: Bot, href: "/agents", color: "#ff9ff3" },
    { label: "New Post", icon: Send, href: "/social", color: "#22c55e" },
  ];

  const statCards = [
    {
      label: "Installed Agents",
      value: stats.installedAgents,
      icon: Bot,
      color: "#8b5cf6",
    },
    {
      label: "Running Tasks",
      value: stats.runningTasks,
      icon: Loader2,
      color: "#38bdf8",
    },
    {
      label: "Tasks Done Today",
      value: stats.tasksCompletedToday,
      icon: CheckCircle2,
      color: "#22c55e",
    },
    { label: "Credits", value: stats.credits, icon: Coins, color: "#f59e0b" },
    {
      label: "Deployments",
      value: stats.deployments,
      icon: Rocket,
      color: "#ff00a0",
    },
    {
      label: "Generated Assets",
      value: stats.generatedAssets,
      icon: Box,
      color: "#00f0ff",
    },
  ];

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Welcome + Universal Command */}
      <section
        className="relative overflow-hidden rounded-2xl border p-4"
        style={{ borderColor: T.borderColor + "25", backgroundColor: T.boxBg }}
      >
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-20 blur-3xl"
          style={{
            background: `radial-gradient(circle, ${T.accentColor}, transparent 70%)`,
          }}
        />
        <div className="relative">
          <h1
            className="text-lg font-black tracking-tight"
            style={{ color: T.textColor }}
          >
            Welcome back, {displayName}
          </h1>
          <p className="text-xs" style={{ color: T.textMuted }}>
            What do you want LiTT to build today?
          </p>
          <button
            onClick={() => router.push("/studio")}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition hover:border-cyan-500/30 hover:bg-white/5"
            style={{ borderColor: T.borderColor + "25", color: T.textColor }}
            aria-label="Open Studio universal command"
          >
            <Zap
              size={16}
              aria-hidden="true"
              style={{ color: T.accentColor }}
            />
            <span style={{ color: T.textMuted }}>Ask LiTT anything…</span>
          </button>
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <SectionHeader title="Quick Actions" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.label}
                href={a.href}
                className="group flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition hover:scale-[1.02]"
                style={{
                  borderColor: a.color + "25",
                  backgroundColor: T.boxBg,
                }}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg transition group-hover:scale-110"
                  style={{
                    backgroundColor: a.color + "15",
                    border: `1px solid ${a.color}30`,
                  }}
                >
                  <Icon
                    size={18}
                    aria-hidden="true"
                    style={{ color: a.color }}
                  />
                </div>
                <span
                  className="text-[10px] font-bold"
                  style={{ color: T.textColor }}
                >
                  {a.label}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Needs Attention */}
      {attention.length > 0 && (
        <section>
          <SectionHeader title="Needs Attention" />
          <div className="space-y-2">
            {attention.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-xl border p-3"
                style={{
                  borderColor: T.borderColor + "20",
                  backgroundColor: T.bgColor + "60",
                }}
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor:
                      item.type === "error"
                        ? "#ef444415"
                        : item.type === "tip"
                          ? "#22c55e15"
                          : "#38bdf815",
                    border: `1px solid ${
                      item.type === "error"
                        ? "#ef444430"
                        : item.type === "tip"
                          ? "#22c55e30"
                          : "#38bdf830"
                    }`,
                  }}
                >
                  {item.type === "error" ? (
                    <AlertCircle
                      size={14}
                      aria-hidden="true"
                      style={{ color: "#ef4444" }}
                    />
                  ) : item.type === "tip" ? (
                    <CheckCircle2
                      size={14}
                      aria-hidden="true"
                      style={{ color: "#22c55e" }}
                    />
                  ) : (
                    <Loader2
                      size={14}
                      aria-hidden="true"
                      style={{ color: "#38bdf8" }}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-xs font-bold"
                    style={{ color: T.textColor }}
                  >
                    {item.message}
                  </p>
                </div>
                {item.href && (
                  <Link
                    href={item.href}
                    className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold transition hover:opacity-80"
                    style={{
                      backgroundColor: T.accentColor + "15",
                      color: T.accentColor,
                    }}
                  >
                    {item.action}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Agents + Running Tasks */}
      <section>
        <SectionHeader title="Active Agents" action="Manage" href="/agents" />
        {agents.length === 0 ? (
          <div
            className="rounded-xl border p-4 text-center text-xs"
            style={{
              borderColor: T.borderColor + "20",
              backgroundColor: T.bgColor + "60",
              color: T.textMuted,
            }}
          >
            No agents installed yet.{" "}
            <Link
              href="/agents"
              className="font-bold"
              style={{ color: T.accentColor }}
            >
              Install your first agent.
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {agents.slice(0, 6).map((agent) => {
              const agentTasks = tasks.filter(
                (t) => t.agent.slug === agent.slug,
              );
              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 rounded-xl border p-3"
                  style={{
                    borderColor: T.borderColor + "20",
                    backgroundColor: T.bgColor + "60",
                  }}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black"
                    style={{
                      backgroundColor: T.accentColor + "15",
                      color: T.accentColor,
                      border: `1px solid ${T.accentColor}30`,
                    }}
                  >
                    {agent.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-bold"
                        style={{ color: T.textColor }}
                      >
                        {agent.name}
                      </span>
                      <span
                        className="text-[9px]"
                        style={{ color: T.textMuted }}
                      >
                        {agent.role}
                      </span>
                    </div>
                    <p
                      className="truncate text-[10px]"
                      style={{ color: T.textMuted }}
                    >
                      {agentTasks.length > 0
                        ? `${agentTasks.length} running task${agentTasks.length > 1 ? "s" : ""}`
                        : agent.description || "Ready"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {agentTasks.length > 0 && (
                      <button
                        onClick={() => router.push("/studio?tool=agents")}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:bg-white/5"
                        style={{
                          borderColor: T.borderColor + "25",
                          color: T.textColor,
                        }}
                        aria-label={`Open ${agent.name} in Studio`}
                        title="Open in Studio"
                      >
                        <ExternalLink size={12} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      onClick={() =>
                        router.push(`/studio?tool=agents&agent=${agent.slug}`)
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:bg-white/5"
                      style={{
                        borderColor: T.borderColor + "25",
                        color: T.textColor,
                      }}
                      aria-label={`Chat with ${agent.name}`}
                      title={`Chat with ${agent.name}`}
                    >
                      <MessageSquare size={12} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Continue Working */}
      {(continueWorking.conversations.length > 0 ||
        continueWorking.media.length > 0 ||
        continueWorking.posts.length > 0) && (
        <section>
          <SectionHeader title="Continue Working" />
          <div className="space-y-2">
            {continueWorking.conversations.slice(0, 3).map((c) => (
              <Link
                key={c.id}
                href={`/studio?tool=agents&conversation=${c.id}`}
                className="flex items-center gap-3 rounded-xl border p-3 transition hover:bg-white/5"
                style={{
                  borderColor: T.borderColor + "20",
                  backgroundColor: T.bgColor + "60",
                }}
              >
                <MessageSquare
                  size={14}
                  aria-hidden="true"
                  style={{ color: T.accentColor }}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-xs font-bold"
                    style={{ color: T.textColor }}
                  >
                    {c.title}
                  </p>
                  <p className="text-[9px]" style={{ color: T.textMuted }}>
                    Studio session · {formatTime(c.updatedAt)}
                  </p>
                </div>
                <ArrowRight
                  size={12}
                  aria-hidden="true"
                  style={{ color: T.textMuted }}
                />
              </Link>
            ))}
            {continueWorking.media.slice(0, 3).map((m) => {
              const Icon = typeIcon(m.type);
              return (
                <Link
                  key={m.id}
                  href="/gallery"
                  className="flex items-center gap-3 rounded-xl border p-3 transition hover:bg-white/5"
                  style={{
                    borderColor: T.borderColor + "20",
                    backgroundColor: T.bgColor + "60",
                  }}
                >
                  <Icon
                    size={14}
                    aria-hidden="true"
                    style={{ color: T.linkColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-xs font-bold"
                      style={{ color: T.textColor }}
                    >
                      {m.caption ||
                        `${m.type.charAt(0).toUpperCase() + m.type.slice(1)} generation`}
                    </p>
                    <p className="text-[9px]" style={{ color: T.textMuted }}>
                      {m.type} · {formatTime(m.createdAt)}
                    </p>
                  </div>
                  <ArrowRight
                    size={12}
                    aria-hidden="true"
                    style={{ color: T.textMuted }}
                  />
                </Link>
              );
            })}
            {continueWorking.posts.slice(0, 2).map((p) => (
              <Link
                key={p.id}
                href="/social"
                className="flex items-center gap-3 rounded-xl border p-3 transition hover:bg-white/5"
                style={{
                  borderColor: T.borderColor + "20",
                  backgroundColor: T.bgColor + "60",
                }}
              >
                <Send
                  size={14}
                  aria-hidden="true"
                  style={{ color: "#22c55e" }}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="line-clamp-2 text-xs"
                    style={{ color: T.textColor }}
                  >
                    {p.content}
                  </p>
                  <p className="text-[9px]" style={{ color: T.textMuted }}>
                    Post · {p.likes} likes · {formatTime(p.createdAt)}
                  </p>
                </div>
                <ArrowRight
                  size={12}
                  aria-hidden="true"
                  style={{ color: T.textMuted }}
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Workspace Stats */}
      <section>
        <SectionHeader title="Workspace Stats" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {statCards.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="rounded-xl border p-3"
                style={{
                  borderColor: T.borderColor + "20",
                  backgroundColor: T.bgColor + "60",
                }}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <Icon
                    size={12}
                    aria-hidden="true"
                    style={{ color: s.color }}
                  />
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider"
                    style={{ color: T.textMuted }}
                  >
                    {s.label}
                  </span>
                </div>
                <div className="text-lg font-black" style={{ color: s.color }}>
                  {s.value}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent Deployments */}
      {deployments.length > 0 && (
        <section>
          <SectionHeader
            title="Recent Deployments"
            action="View all"
            href="/deployments"
          />
          <div className="space-y-2">
            {deployments.slice(0, 5).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-xl border p-3"
                style={{
                  borderColor: T.borderColor + "20",
                  backgroundColor: T.bgColor + "60",
                }}
              >
                <div className="min-w-0">
                  <p
                    className="text-xs font-bold"
                    style={{ color: T.textColor }}
                  >
                    {d.branch || "Unknown branch"} → {d.environment}
                  </p>
                  <p className="text-[9px]" style={{ color: T.textMuted }}>
                    {formatTime(d.updatedAt)}
                  </p>
                </div>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Activity feed (real user events only) */}
      <section>
        <SectionHeader
          title="Recent Activity"
          action="Social feed"
          href="/social"
        />
        <div className="space-y-2">
          {tasks.slice(0, 4).map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-3 rounded-xl border p-3"
              style={{
                borderColor: T.borderColor + "20",
                backgroundColor: T.bgColor + "60",
              }}
            >
              <div
                className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    t.status === "running"
                      ? "#38bdf8"
                      : t.status === "failed"
                        ? "#ef4444"
                        : "#22c55e",
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold" style={{ color: T.textColor }}>
                  {t.agent.name} {t.status === "running" ? "started" : t.status}{" "}
                  {t.type || "task"}
                </p>
                <p
                  className="truncate text-[10px]"
                  style={{ color: T.textMuted }}
                >
                  {t.input || "No details"}
                </p>
                <p className="text-[9px]" style={{ color: T.textMuted }}>
                  {formatTime(t.createdAt)}
                </p>
              </div>
            </div>
          ))}
          {tasks.length === 0 && (
            <div
              className="rounded-xl border p-4 text-center text-xs"
              style={{
                borderColor: T.borderColor + "20",
                backgroundColor: T.bgColor + "60",
                color: T.textMuted,
              }}
            >
              No agent activity yet. Start a task in{" "}
              <Link
                href="/studio"
                className="font-bold"
                style={{ color: T.accentColor }}
              >
                Studio
              </Link>
              .
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function formatTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
