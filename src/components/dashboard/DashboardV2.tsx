"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import MusicPlayer from "@/components/dashboard/MusicPlayer";

/* ---------- Inline SVG icons ---------- */
function Icon({ name, size = 16, className = "", style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const paths: Record<string, string> = {
    git: "M6 3v12 M18 9l-6 6-6-6 M3 9h6 M15 9h6",
    branch: "M6 3v12 M18 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z M6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z M6 9v6a3 3 0 0 0 3 3h6",
    rocket: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z M9 12H4s.55-3.03 2-4c1.62-1.16 5-1 5-1 M12 15v5s3.03-.55 4-2c1.16-1.62 1-5 1-5",
    refresh: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
    terminal: "M4 17l6-5-6-5 M12 19h8",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    activity: "M22 12h-4l-3 9L9 3l-3 9H2",
    check: "M20 6L9 17l-5-5",
    x: "M18 6L6 18 M6 6l12 12",
    alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
    external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3",
    bot: "M12 8V4H8 M4 8h16v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z M2 14h2 M20 14h2 M15 13v.01 M9 13v.01",
    pulse: "M3 12h4l3 9 4-16 3 7h4",
    chevron: "M9 18l6-6-6-6",
    folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
    link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    image: "M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6",
    code: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
    wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4z",
    sparkles: "M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z",
    target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01",
    play: "M6 4l14 8-14 8z",
    plus: "M12 5v14 M5 12h14",
    zap: "M13 2L3 14h9l-1 8 10-12h-9z",
    arrow: "M5 12h14 M12 5l7 7-7 7",
    package: "M16.5 9.4L7.5 4.21 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
    music: "M9 18V5l12-2v13 M9 9l12-2 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    heart: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
    comment: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
    inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d={paths[name] || ""} />
    </svg>
  );
}

/* ---------- Types ---------- */
type IntegrationProject = {
  id: string; provider: string; repository_id: number | null; repository_full_name: string | null;
  repository_html_url: string | null; repository_private: boolean; default_branch: string | null;
  working_branch: string | null; latest_commit_sha: string | null; latest_commit_message: string | null;
  latest_commit_author: string | null; latest_commit_date: string | null;
  open_prs_count: number; open_issues_count: number;
  github_actions_status: Record<string, unknown>;
  vercel_project_id: string | null; vercel_deployment_url: string | null; vercel_production_url: string | null;
  vercel_status: string | null; last_synced_at: string | null; sync_status: string; sync_error: string | null;
};

type LegacyProject = {
  id: string; name: string; status: string; owner?: string; repository?: string; working_branch?: string;
  connection_status: string; repository_full_name?: string; repository_html_url?: string;
  repository_private?: boolean; selected_branch?: string; connected_at?: string; last_synced_at?: string;
};

type IntegrationEvent = {
  id: string; provider: string; event_type: string; title: string; description: string | null;
  severity: string; actor: string | null; url: string | null; read_at: string | null; created_at: string;
};

type IntegrationAccount = {
  id: string; provider: string; provider_account_id: string | null; provider_account_name: string | null;
  status: string; last_connected_at: string | null; last_synced_at: string | null; last_error: string | null;
  metadata: Record<string, unknown>;
};

type DashboardData = {
  accounts: IntegrationAccount[];
  projects: IntegrationProject[];
  legacyProjects: LegacyProject[];
  events: IntegrationEvent[];
  unreadCount: number;
  deployments: Array<Record<string, unknown>>;
  installations: Array<{ installation_id: number; user_id: string; created_at: string }>;
};

type LlmHealth = {
  gemini?: { available: boolean; model: string };
  openrouter?: { available: boolean; model: string };
};

type SocialPost = {
  id: string;
  content: string;
  likes_count: number;
  comments_count: number;
  created_at: string;
  author?: { name: string; username: string; avatar_url: string } | null;
};

/* ---------- Helpers ---------- */
function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const STATUS_COLORS: Record<string, string> = {
  connected: "#B6FF4A", synced: "#B6FF4A", ready: "#B6FF4A",
  degraded: "#F97316", expired: "#F97316", behind: "#F97316",
  missing_permission: "#ef4444", offline: "#6b7280", disconnected: "#6b7280",
  syncing: "#3b82f6", error: "#ef4444", pending: "#6b7280",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "#3b82f6", success: "#B6FF4A", warning: "#F97316",
  error: "#ef4444", critical: "#dc2626",
};

/* ---------- Card Shell ---------- */
function Card({ title, icon, action, children, colSpan = "lg:col-span-8" }: {
  title: string; icon?: string; action?: React.ReactNode; children: React.ReactNode; colSpan?: string;
}) {
  const T = useTheme().resolvedColors;
  return (
    <section className={`${colSpan}`}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] opacity-50">
          {icon && <Icon name={icon} size={13} />}
          {title}
        </h2>
        {action}
      </div>
      <div className="rounded-2xl p-4 lg:p-5" style={{ background: `${T.boxBg}90`, border: `1px solid ${T.borderColor}30` }}>
        {children}
      </div>
    </section>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 animate-pulse" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="h-4 w-32 rounded bg-white/5 mb-3" />
      <div className="h-3 w-48 rounded bg-white/5 mb-2" />
      <div className="h-3 w-24 rounded bg-white/5 mb-4" />
      <div className="flex gap-2"><div className="h-6 w-20 rounded bg-white/5" /><div className="h-6 w-20 rounded bg-white/5" /></div>
    </div>
  );
}

function ActionButton({ href, label, primary, color, icon }: {
  href: string; label: string; primary?: boolean; color?: string; icon?: string;
}) {
  const T = useTheme().resolvedColors;
  const c = color || T.accentColor;
  if (primary) {
    return (
      <Link href={href} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:scale-[1.02]" style={{ background: c, color: T.bgColor }}>
        {icon && <Icon name={icon} size={14} />}{label}
      </Link>
    );
  }
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:opacity-80" style={{ background: `${c}20`, color: c, border: `1px solid ${c}30` }}>
      {icon && <Icon name={icon} size={14} />}{label}
    </Link>
  );
}

function ConnectionPulse({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "#6b7280";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === "connected" || status === "synced" || status === "ready" ? (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />
      ) : null}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

/* ---------- 1. LiTT Daily Brief ---------- */
function DailyBrief({ data, loading, attentionCount }: {
  data: DashboardData | null; loading: boolean; attentionCount: number;
}) {
  const T = useTheme().resolvedColors;
  const projects = [...(data?.projects || []), ...(data?.legacyProjects || [])];
  const hasProject = projects.length > 0;
  const hasGithub = data?.accounts?.some((a) => a.provider === "github" && a.status === "connected");

  if (loading) {
    return (
      <div className="rounded-2xl p-5 animate-pulse" style={{ background: `${T.boxBg}90`, border: `1px solid ${T.borderColor}30`, minHeight: 120 }} />
    );
  }

  const facts: string[] = [];
  if (hasProject) facts.push(`${projects.length} project${projects.length === 1 ? "" : "s"} connected`);
  if (hasGithub) facts.push("GitHub synced");
  if (attentionCount > 0) facts.push(`${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`);
  if (data?.events?.length) facts.push(`${data.events.length} recent event${data.events.length === 1 ? "" : "s"}`);
  if (facts.length === 0) facts.push("No projects connected yet");

  return (
    <div className="rounded-2xl p-5" style={{ background: `linear-gradient(135deg, ${T.accentColor}10 0%, ${T.boxBg} 60%)`, border: `1px solid ${T.accentColor}25` }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-[0.2em] mb-2" style={{ color: T.accentColor }}>LiTT Daily Brief</div>
          <div className="flex flex-wrap gap-2">
            {facts.map((fact, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: `${T.borderColor}20`, color: T.textColor }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: T.accentColor }} />
                {fact}
              </span>
            ))}
          </div>
        </div>
        <ActionButton href="/studio" label="Open Studio" primary icon="play" />
      </div>
    </div>
  );
}

/* ---------- 2. Continue Project ---------- */
function ContinueProject({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const projects = [...(data?.projects || []), ...(data?.legacyProjects || [])];
  const hasProject = projects.length > 0;

  if (loading) return <SkeletonCard />;

  if (!hasProject) {
    return (
      <div className="rounded-2xl p-5" style={{ background: `${T.boxBg}90`, border: `1px solid ${T.borderColor}30` }}>
        <div className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No project yet</div>
        <p className="text-xs opacity-50 mb-4">Connect GitHub or start a blank project to get started.</p>
        <div className="flex gap-2">
          <ActionButton href="/studio/github" label="Connect GitHub" primary icon="git" />
          <ActionButton href="/projects/new" label="Start Blank" icon="plus" />
        </div>
      </div>
    );
  }

  const p = projects[0];
  const name = (p as IntegrationProject).repository_full_name || (p as LegacyProject).name || "Untitled";
  const branch = (p as IntegrationProject).working_branch || (p as IntegrationProject).default_branch || (p as LegacyProject).working_branch || "main";
  const lastActivity = (p as IntegrationProject).last_synced_at || (p as LegacyProject).last_synced_at || null;
  const vercelUrl = (p as IntegrationProject).vercel_production_url || null;
  const syncStatus = (p as IntegrationProject).sync_status || (p as LegacyProject).connection_status || "pending";

  return (
    <div className="rounded-2xl p-5" style={{ background: `linear-gradient(135deg, ${T.accentColor}10 0%, ${T.boxBg} 60%)`, border: `1px solid ${T.accentColor}25` }}>
      <div className="text-xs font-black uppercase tracking-[0.2em] mb-2" style={{ color: T.accentColor }}>Continue Building</div>
      <h3 className="text-xl font-black mb-2 truncate" style={{ color: T.headerColor }}>{name}</h3>
      <div className="flex flex-wrap items-center gap-3 text-xs mb-4" style={{ color: T.textMuted }}>
        <span className="flex items-center gap-1"><Icon name="branch" size={12} />{branch}</span>
        <span className="flex items-center gap-1"><Icon name="clock" size={12} />{timeAgo(lastActivity)}</span>
        <span className="flex items-center gap-1.5"><ConnectionPulse status={syncStatus} />{syncStatus}</span>
        {vercelUrl && <span className="flex items-center gap-1" style={{ color: "#B6FF4A" }}><Icon name="rocket" size={12} />Live</span>}
      </div>
      <div className="flex gap-2">
        <ActionButton href="/studio?tool=chat" label="Resume in Studio" primary icon="play" />
        <ActionButton href="/projects" label="View Project" icon="folder" />
      </div>
    </div>
  );
}

/* ---------- 3. Current Mission ---------- */
function CurrentMission({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const events = data?.events || [];
  const missions = events.filter((e) => e.event_type === "mission_created" || e.event_type === "mission_updated").slice(0, 3);

  if (loading) return <SkeletonCard />;

  if (missions.length === 0) {
    return (
      <div className="py-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${T.accentColor}10`, border: `1px solid ${T.accentColor}20` }}>
          <Icon name="target" size={18} style={{ color: T.accentColor }} />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No active Missions</p>
        <p className="text-xs opacity-50 mb-3">Start a Mission in Studio and it will appear here.</p>
        <ActionButton href="/studio?tool=workflows" label="Open Mission Forge" icon="target" />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {missions.map((m) => {
        const color = SEVERITY_COLORS[m.severity] || "#3b82f6";
        return (
          <div key={m.id} className="rounded-xl p-3" style={{ background: `${color}08`, borderLeft: `3px solid ${color}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>{m.title}</span>
              <span className="text-xs font-semibold uppercase" style={{ color }}>{m.severity}</span>
            </div>
            {m.description && <p className="text-xs opacity-50 truncate">{m.description}</p>}
            <div className="text-xs opacity-30 mt-1">{timeAgo(m.created_at)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- 4. Unified Inbox ---------- */
function UnifiedInbox({ data, loading, onMarkAllRead }: {
  data: DashboardData | null; loading: boolean; onMarkAllRead: () => void;
}) {
  const T = useTheme().resolvedColors;

  const items = useMemo(() => {
    const errorEvents = (data?.events || []).filter((e) => e.severity === "error" || e.severity === "critical" || e.severity === "warning").slice(0, 5);
    const accountErrors = (data?.accounts || []).filter((a) => a.last_error || a.status === "expired" || a.status === "missing_permission");
    return [
      ...errorEvents.map((e) => ({ id: e.id, severity: e.severity, message: e.title, time: e.created_at, area: e.provider })),
      ...accountErrors.map((a) => ({ id: a.id, severity: a.status === "expired" ? "warning" : "error", message: a.last_error || `${a.provider} needs attention`, time: a.last_synced_at, area: a.provider })),
    ];
  }, [data]);

  if (loading) return <SkeletonCard />;

  if (items.length === 0) {
    return (
      <div className="py-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "#B6FF4A10", border: "1px solid #B6FF4A20" }}>
          <Icon name="check" size={18} style={{ color: "#B6FF4A" }} />
        </div>
        <p className="text-sm font-bold" style={{ color: T.headerColor }}>Inbox zero</p>
        <p className="text-xs opacity-40 mt-1">No errors, warnings, or pending approvals.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const color = SEVERITY_COLORS[item.severity] || "#F97316";
        return (
          <div key={item.id} className="flex items-start gap-3 rounded-lg p-2.5" style={{ background: `${color}08`, borderLeft: `2px solid ${color}` }}>
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}15`, color }}>
              <Icon name="alert" size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate" style={{ color: T.textColor }}>{item.message}</div>
              <div className="text-xs opacity-30 mt-0.5">{item.area} · {timeAgo(item.time)}</div>
            </div>
          </div>
        );
      })}
      {data && data.unreadCount > 0 && (
        <button onClick={onMarkAllRead} className="text-xs font-semibold opacity-50 hover:opacity-80 mt-2">Mark all read</button>
      )}
    </div>
  );
}

/* ---------- 5. Your World Preview ---------- */
function YourWorldPreview() {
  const T = useTheme().resolvedColors;
  const { profile } = useProfile();
  const { user } = useAppUser();
  const displayName = profile?.displayName || user?.firstName || user?.username || "Member";
  const username = profile?.username || user?.username || "member";
  const bio = profile?.bio || "No bio yet";
  const avatarUrl = profile?.avatarUrl || user?.imageUrl || null;

  return (
    <div className="flex items-center gap-4">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={displayName} className="h-14 w-14 rounded-full object-cover" style={{ border: `1px solid ${T.borderColor}40` }} />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-black" style={{ background: `${T.accentColor}15`, color: T.accentColor, border: `1px solid ${T.accentColor}30` }}>
          {displayName[0]?.toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold truncate" style={{ color: T.headerColor }}>{displayName}</div>
        <div className="text-xs opacity-50 truncate">@{username}</div>
        <div className="text-xs opacity-40 truncate mt-1">{bio}</div>
      </div>
      <Link href={`/world/${username}`} className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80" style={{ background: `${T.accentColor}20`, color: T.accentColor }}>
        View
      </Link>
    </div>
  );
}

/* ---------- 6. Recent Work ---------- */
function RecentWork({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const allProjects = [...(data?.projects || []), ...(data?.legacyProjects || [])];
  const creations = (data?.events || []).filter((e) => e.event_type === "media_generated" || e.event_type === "artifact_created" || e.event_type === "image_generated").slice(0, 4);

  if (loading) return <SkeletonCard />;

  const hasAny = allProjects.length > 0 || creations.length > 0;

  if (!hasAny) {
    return (
      <div className="py-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${T.accentColor}10`, border: `1px solid ${T.accentColor}20` }}>
          <Icon name="package" size={18} style={{ color: T.accentColor }} />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No recent work</p>
        <p className="text-xs opacity-50 mb-3">Projects and creations will appear here.</p>
        <ActionButton href="/studio" label="Open Studio" icon="sparkles" />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {allProjects.slice(0, 3).map((proj) => {
        const name = (proj as IntegrationProject).repository_full_name || (proj as LegacyProject).name || "Untitled";
        const syncStatus = (proj as IntegrationProject).sync_status || (proj as LegacyProject).connection_status || "pending";
        return (
          <Link key={proj.id} href="/studio?tool=chat" className="block rounded-xl p-3 transition-all hover:opacity-80" style={{ background: `${T.boxBg}80`, border: `1px solid ${T.borderColor}20` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>{name}</span>
              <ConnectionPulse status={syncStatus} />
            </div>
            <div className="text-xs opacity-40">{timeAgo((proj as IntegrationProject).last_synced_at || (proj as LegacyProject).last_synced_at || null)}</div>
          </Link>
        );
      })}
      {creations.map((c) => {
        const color = SEVERITY_COLORS[c.severity] || "#ec4899";
        return (
          <Link key={c.id} href="/gallery" className="block rounded-xl p-3 transition-all hover:opacity-80" style={{ background: `${T.boxBg}80`, border: `1px solid ${color}20` }}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}15` }}>
                <Icon name="image" size={14} style={{ color }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold truncate" style={{ color: T.headerColor }}>{c.title}</div>
                <div className="text-xs opacity-30">{timeAgo(c.created_at)}</div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ---------- 7. Community Pulse ---------- */
function CommunityPulse({ socialPosts, socialLoading }: { socialPosts: SocialPost[]; socialLoading: boolean }) {
  const T = useTheme().resolvedColors;

  if (socialLoading) return <SkeletonCard />;

  if (socialPosts.length === 0) {
    return (
      <div className="py-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "#ff00a010", border: "1px solid #ff00a020" }}>
          <Icon name="users" size={18} style={{ color: "#ff00a0" }} />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No community activity yet</p>
        <p className="text-xs opacity-50 mb-3">Be the first to share something on Discover.</p>
        <ActionButton href="/discover" label="Open Discover" icon="globe" color="#ff00a0" />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {socialPosts.slice(0, 4).map((post) => (
        <Link key={post.id} href="/discover" className="block rounded-xl p-3 transition-all hover:opacity-80" style={{ background: `${T.boxBg}80`, border: `1px solid ${T.borderColor}20` }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black" style={{ background: "#ff00a015", color: "#ff00a0" }}>
              {(post.author?.name || "U")[0]?.toUpperCase()}
            </div>
            <span className="text-xs font-bold truncate" style={{ color: T.headerColor }}>{post.author?.name || "Unknown"}</span>
            <span className="text-xs opacity-30">· {timeAgo(post.created_at)}</span>
          </div>
          <p className="text-xs opacity-60 truncate ml-8">{post.content}</p>
          <div className="flex items-center gap-3 mt-1.5 ml-8 text-xs opacity-30">
            <span className="flex items-center gap-1"><Icon name="heart" size={10} />{post.likes_count}</span>
            <span className="flex items-center gap-1"><Icon name="comment" size={10} />{post.comments_count}</span>
          </div>
        </Link>
      ))}
      <Link href="/discover" className="inline-flex items-center gap-1 text-xs font-bold transition-all hover:opacity-80" style={{ color: "#ff00a0" }}>
        Open Discover <Icon name="arrow" size={10} />
      </Link>
    </div>
  );
}

/* ---------- 8. Collapsed System Health ---------- */
function SystemHealth({ data, llmHealth, loading }: {
  data: DashboardData | null; llmHealth: LlmHealth | null; loading: boolean;
}) {
  const T = useTheme().resolvedColors;
  const [expanded, setExpanded] = useState(false);

  const checks = useMemo(() => {
    const result: Array<{ label: string; status: string; detail: string }> = [];
    const providers = ["github", "vercel", "supabase"];
    for (const p of providers) {
      const acc = data?.accounts?.find((a) => a.provider === p);
      if (acc) {
        result.push({ label: p.charAt(0).toUpperCase() + p.slice(1), status: acc.status, detail: acc.provider_account_name || acc.status });
      }
    }
    result.push({ label: "Gemini", status: llmHealth?.gemini?.available ? "ready" : "disconnected", detail: llmHealth?.gemini?.available ? llmHealth.gemini.model : "API key required" });
    result.push({ label: "OpenRouter", status: llmHealth?.openrouter?.available ? "ready" : "disconnected", detail: llmHealth?.openrouter?.available ? llmHealth.openrouter.model : "API key required" });
    return result;
  }, [data, llmHealth]);

  const okCount = checks.filter((c) => c.status === "connected" || c.status === "synced" || c.status === "ready").length;
  const totalCount = checks.length;
  const allOk = okCount === totalCount;
  const color = allOk ? "#B6FF4A" : okCount === 0 ? "#ef4444" : "#F97316";

  if (loading) return <SkeletonCard />;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl p-3 transition-all hover:opacity-80"
        style={{ background: `${color}08`, border: `1px solid ${color}20` }}
      >
        <div className="flex items-center gap-3">
          <ConnectionPulse status={allOk ? "connected" : okCount === 0 ? "disconnected" : "degraded"} />
          <span className="text-sm font-bold" style={{ color: T.headerColor }}>System Health</span>
          <span className="text-xs opacity-50">{okCount}/{totalCount} services connected</span>
        </div>
        <Icon name="chevron" size={14} style={{ transform: expanded ? "rotate(180deg)" : "none", opacity: 0.4 }} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {checks.map((c) => {
            return (
              <div key={c.label} className="flex items-center gap-3 rounded-lg p-2" style={{ background: `${T.borderColor}10` }}>
                <ConnectionPulse status={c.status} />
                <span className="text-sm font-bold flex-1" style={{ color: T.headerColor }}>{c.label}</span>
                <span className="text-xs opacity-50 flex-1 truncate">{c.detail}</span>
              </div>
            );
          })}
          <Link href="/settings/connections" className="inline-flex items-center gap-1 text-xs font-bold transition-all hover:opacity-80" style={{ color: T.accentColor }}>
            Manage Connections <Icon name="arrow" size={10} />
          </Link>
        </div>
      )}
    </div>
  );
}

/* ---------- Main Component ---------- */
export function DashboardV2() {
  const T = useTheme().resolvedColors;
  const { user } = useAppUser();
  const { profile } = useProfile();
  const [data, setData] = useState<DashboardData | null>(null);
  const [llmHealth, setLlmHealth] = useState<LlmHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [socialLoading, setSocialLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, healthRes, socialRes] = await Promise.allSettled([
        fetch("/api/dashboard"),
        fetch("/api/llm/health"),
        fetch("/api/posts?limit=5"),
      ]);
      if (dashRes.status === "fulfilled" && dashRes.value.ok) {
        setData(await dashRes.value.json());
      }
      if (healthRes.status === "fulfilled" && healthRes.value.ok) {
        setLlmHealth(await healthRes.value.json());
      }
      if (socialRes.status === "fulfilled" && socialRes.value.ok) {
        const socialJson = await socialRes.value.json();
        setSocialPosts(socialJson.posts ?? socialJson ?? []);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setSocialLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/dashboard/events/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setData((prev) => prev ? { ...prev, unreadCount: 0, events: prev.events.map((e) => ({ ...e, read_at: e.read_at || new Date().toISOString() })) } : prev);
    } catch { /* non-fatal */ }
  };

  const displayName = profile?.displayName || user?.firstName || user?.username || "Member";

  const attentionCount = useMemo(() => {
    const errorEvents = (data?.events || []).filter((e) => e.severity === "error" || e.severity === "critical" || e.severity === "warning").length;
    const accountErrors = (data?.accounts || []).filter((a) => a.last_error || a.status === "expired" || a.status === "missing_permission").length;
    return errorEvents + accountErrors;
  }, [data]);

  const greetingSubtext = loading
    ? "Loading your workspace..."
    : attentionCount > 0
      ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention.`
      : "Everything is quiet. Start something new.";

  return (
    <div className="min-h-screen backdrop-blur-sm" style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}>
      <div className="mx-auto max-w-7xl p-4 lg:p-8">
        {/* Greeting */}
        <div className="mb-6 flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between" style={{ background: `linear-gradient(135deg, ${T.accentColor}08 0%, transparent 70%)`, borderBottom: `1px solid ${T.borderColor}20` }}>
          <div>
            <h1 className="text-2xl font-black lg:text-3xl" style={{ color: T.headerColor }}>
              {getGreeting()}, {displayName}
            </h1>
            <p className="text-sm mt-1" style={{ color: T.textMuted }}>{greetingSubtext}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/discover" className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80" style={{ background: "#ff00a015", color: "#ff00a0", border: "1px solid #ff00a030" }}>
              <Icon name="globe" size={14} />Discover
            </Link>
            <Link href="/studio" className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:scale-[1.02]" style={{ background: T.accentColor, color: T.bgColor }}>
              <Icon name="sparkles" size={14} />Open Studio
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl p-3 text-sm" style={{ background: "#ef444410", color: "#ef4444", border: "1px solid #ef444430" }}>
            <Icon name="alert" size={14} className="inline mr-2" />{error}
          </div>
        )}

        {/* Dashboard Grid — mobile-first ordering */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 1. Daily Brief — full width */}
          <div className="lg:col-span-12">
            <DailyBrief data={data} loading={loading} attentionCount={attentionCount} />
          </div>

          {/* 2. Continue Project — large */}
          <Card title="Continue Project" icon="folder" colSpan="lg:col-span-8">
            <ContinueProject data={data} loading={loading} />
          </Card>

          {/* 3. Current Mission — sidebar */}
          <Card title="Current Mission" icon="target" colSpan="lg:col-span-4">
            <CurrentMission data={data} loading={loading} />
          </Card>

          {/* 4. Unified Inbox — medium */}
          <Card title="Unified Inbox" icon="inbox" colSpan="lg:col-span-8">
            <UnifiedInbox data={data} loading={loading} onMarkAllRead={handleMarkAllRead} />
          </Card>

          {/* 5. Your World — sidebar */}
          <Card title="Your World" icon="users" colSpan="lg:col-span-4" action={<Link href="/discover" className="text-xs font-bold opacity-50 hover:opacity-80">Discover →</Link>}>
            <YourWorldPreview />
          </Card>

          {/* 6. Recent Work — medium */}
          <Card title="Recent Work" icon="package" colSpan="lg:col-span-8">
            <RecentWork data={data} loading={loading} />
          </Card>

          {/* 7. Community Pulse — sidebar */}
          <Card title="Community Pulse" icon="heart" colSpan="lg:col-span-4" action={<Link href="/discover" className="text-xs font-bold opacity-50 hover:opacity-80">Open →</Link>}>
            <CommunityPulse socialPosts={socialPosts} socialLoading={socialLoading} />
          </Card>

          {/* 8. System Health — full width, collapsed */}
          <Card title="System Health" icon="activity" colSpan="lg:col-span-8">
            <SystemHealth data={data} llmHealth={llmHealth} loading={loading} />
          </Card>

          {/* Compact Music Player */}
          <Card title="Now Playing" icon="music" colSpan="lg:col-span-4">
            <div className="space-y-2">
              <MusicPlayer mode="mini" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default DashboardV2;
