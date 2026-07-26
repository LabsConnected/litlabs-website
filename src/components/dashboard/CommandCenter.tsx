"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import { FloatingVoiceButton } from "@/features/voice/components/FloatingVoiceButton";

/* ---------- Inline SVG icons (lucide-react pinned to old version) ---------- */
function Icon({ name, size = 16, className = "", style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const paths: Record<string, string> = {
    git: "M6 3v12 M18 9l-6 6-6-6 M3 9h6 M15 9h6",
    branch: "M6 3v12 M18 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z M6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z M6 9v6a3 3 0 0 0 3 3h6",
    commit: "M12 3v18 M6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z M18 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z",
    rocket: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z M9 12H4s.55-3.03 2-4c1.62-1.16 5-1 5-1 M12 15v5s3.03-.55 4-2c1.16-1.62 1-5 1-5",
    refresh: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
    terminal: "M4 17l6-5-6-5 M12 19h8",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    activity: "M22 12h-4l-3 9L9 3l-3 9H2",
    plug: "M12 22v-5 M9 7V2 M15 7V2 M6 7h12v3a6 6 0 0 1-12 0V7z",
    check: "M20 6L9 17l-5-5",
    x: "M18 6L6 18 M6 6l12 12",
    alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
    external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3",
    bot: "M12 8V4H8 M4 8h16v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z M2 14h2 M20 14h2 M15 13v.01 M9 13v.01",
    pulse: "M3 12h4l3 9 4-16 3 7h4",
    sync: "M21 2v6h-6 M3 12a9 9 0 0 1 15-6.7L21 8 M3 22v-6h6 M21 12a9 9 0 0 1-15 6.7L3 16",
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
    package: "M16.5 9.4L7.5 4.21 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
    arrow: "M5 12h14 M12 5l7 7-7 7",
    layers: "M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5",
    eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    eyeOff: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24 M1 1l22 22",
    grip: "M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d={paths[name] || ""} />
    </svg>
  );
}

/* ---------- Types ---------- */
type IntegrationAccount = {
  id: string; provider: string; provider_account_id: string | null; provider_account_name: string | null;
  status: string; last_connected_at: string | null; last_synced_at: string | null; last_error: string | null;
  metadata: Record<string, unknown>;
};

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

type IntegrationEvent = {
  id: string; provider: string; event_type: string; title: string; description: string | null;
  severity: string; actor: string | null; url: string | null; read_at: string | null; created_at: string;
};

type LegacyProject = {
  id: string; name: string; status: string; owner?: string; repository?: string; working_branch?: string;
  connection_status: string; repository_full_name?: string; repository_html_url?: string;
  repository_private?: boolean; selected_branch?: string; connected_at?: string; last_synced_at?: string;
};

type Deployment = { id: string; status?: string; project_name?: string; created_at?: string; url?: string; environment?: string; commit_sha?: string };

type DashboardData = {
  accounts: IntegrationAccount[];
  projects: IntegrationProject[];
  legacyProjects: LegacyProject[];
  events: IntegrationEvent[];
  unreadCount: number;
  deployments: Array<Record<string, unknown>>;
  installations: Array<{ installation_id: number; user_id: string; created_at: string }>;
};

type ConnectionOverview = {
  provider: string; label: string; category: string; status: string;
  externalAccountName: string | null; lastSyncedAt: string | null;
  lastErrorMessage: string | null; isConnected: boolean; connectUrl?: string;
};

type WalletData = { balance: number | null; plan: string };
type UsageData = {
  summary: { totalCommands: number; totalAgentTasks: number; totalGenerations: number; plan: string };
  daily: Array<{ date: string; commands: number; agentTasks: number; generations: number }>;
  demo: boolean;
};

type InstalledCap = { capability_key: string; name: string; compatible_assistants: string[] };

/* ---------- Widget Configuration ---------- */
type WidgetId =
  | "hero" | "quickActions" | "missions" | "attention" | "projects"
  | "creations" | "connections" | "usage" | "activity" | "suggestions"
  | "deployments" | "capabilities" | "assistants";

type WidgetConfig = { id: WidgetId; label: string; visible: boolean; order: number };

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "hero", label: "Continue Building", visible: true, order: 0 },
  { id: "quickActions", label: "Quick Actions", visible: true, order: 1 },
  { id: "missions", label: "Active Missions", visible: true, order: 2 },
  { id: "attention", label: "Needs Attention", visible: true, order: 3 },
  { id: "projects", label: "Recent Projects", visible: true, order: 4 },
  { id: "connections", label: "Connection Health", visible: true, order: 5 },
  { id: "creations", label: "Recent Creations", visible: true, order: 6 },
  { id: "usage", label: "Usage & LiTBits", visible: true, order: 7 },
  { id: "activity", label: "Live Activity", visible: true, order: 8 },
  { id: "suggestions", label: "LiTT Suggestions", visible: true, order: 9 },
  { id: "deployments", label: "Deployments", visible: true, order: 10 },
  { id: "capabilities", label: "Installed Capabilities", visible: true, order: 11 },
  { id: "assistants", label: "Assistants", visible: true, order: 12 },
];

const WIDGET_STORAGE_KEY = "littree-dashboard-widgets-v1";

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

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub", meta: "Meta Developer", vercel: "Vercel", supabase: "Supabase",
};

/* ---------- Sub-components ---------- */

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

function WidgetShell({ title, action, children, colSpan = "lg:col-span-8" }: {
  title: string; action?: React.ReactNode; children: React.ReactNode; colSpan?: string;
}) {
  const T = useTheme().resolvedColors;
  return (
    <section className={`${colSpan}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] opacity-40">{title}</h2>
        {action}
      </div>
      <div className="rounded-2xl p-4 lg:p-5" style={{ background: `${T.boxBg}90`, border: `1px solid ${T.borderColor}30` }}>
        {children}
      </div>
    </section>
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

/* ---------- Hero Widget ---------- */
function HeroWidget({ data, loading }: {
  data: DashboardData | null; loading: boolean;
}) {
  const T = useTheme().resolvedColors;
  const projects = [...(data?.projects || []), ...(data?.legacyProjects || [])];
  const hasProject = projects.length > 0;

  if (loading) {
    return (
      <div className="rounded-2xl p-6 lg:p-8 animate-pulse" style={{ background: `${T.boxBg}90`, border: `1px solid ${T.borderColor}30`, minHeight: 200 }} />
    );
  }

  if (!hasProject) {
    return (
      <div className="relative overflow-hidden rounded-2xl p-6 lg:p-8" style={{ background: `linear-gradient(135deg, ${T.accentColor}12 0%, ${T.boxBg} 60%, ${T.bgColor} 100%)`, border: `1px solid ${T.accentColor}25` }}>
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-15 pointer-events-none" style={{ background: `radial-gradient(circle, ${T.accentColor} 0%, transparent 65%)`, filter: "blur(48px)" }} />
        <div className="relative">
          <div className="text-xs font-black uppercase tracking-[0.2em] mb-2" style={{ color: T.accentColor }}>Start your first Mission</div>
          <h2 className="text-2xl lg:text-3xl font-black mb-2" style={{ color: T.headerColor }}>Connect a repository or create a blank project</h2>
          <p className="text-sm max-w-lg font-medium mb-5" style={{ color: T.textMuted }}>
            LiTT will organize the workspace, files, preview, and history.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton href="/studio/github" label="Connect GitHub" primary icon="git" />
            <ActionButton href="/projects/new" label="Start Blank Project" icon="plus" />
          </div>
        </div>
      </div>
    );
  }

  const latestProject = projects[0];
  const projectName = (latestProject as IntegrationProject).repository_full_name || (latestProject as LegacyProject).name || "Untitled";
  const branch = (latestProject as IntegrationProject).working_branch || (latestProject as IntegrationProject).default_branch || (latestProject as LegacyProject).working_branch || "main";
  const lastActivity = (latestProject as IntegrationProject).last_synced_at || (latestProject as LegacyProject).last_synced_at || null;
  const vercelUrl = (latestProject as IntegrationProject).vercel_production_url || null;
  const syncStatus = (latestProject as IntegrationProject).sync_status || (latestProject as LegacyProject).connection_status || "pending";

  return (
    <div className="relative overflow-hidden rounded-2xl p-6 lg:p-8" style={{ background: `linear-gradient(135deg, ${T.accentColor}12 0%, ${T.boxBg} 60%, ${T.bgColor} 100%)`, border: `1px solid ${T.accentColor}25` }}>
      <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-15 pointer-events-none" style={{ background: `radial-gradient(circle, ${T.accentColor} 0%, transparent 65%)`, filter: "blur(48px)" }} />
      <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full opacity-10 pointer-events-none" style={{ background: `radial-gradient(circle, ${T.accentColor} 0%, transparent 70%)`, filter: "blur(40px)" }} />
      <div className="relative">
        <div className="text-xs font-black uppercase tracking-[0.2em] mb-2" style={{ color: T.accentColor }}>Continue Building</div>
        <h2 className="text-2xl lg:text-3xl font-black mb-1" style={{ color: T.headerColor }}>{projectName}</h2>
        <div className="flex flex-wrap items-center gap-4 text-xs mb-4" style={{ color: T.textMuted }}>
          <span className="flex items-center gap-1"><Icon name="branch" size={12} />{branch}</span>
          <span className="flex items-center gap-1"><Icon name="clock" size={12} />Last activity {timeAgo(lastActivity)}</span>
          <span className="flex items-center gap-1.5"><ConnectionPulse status={syncStatus} />{syncStatus}</span>
          {vercelUrl && <span className="flex items-center gap-1" style={{ color: "#B6FF4A" }}><Icon name="rocket" size={12} />Live</span>}
        </div>
        <div className="flex flex-wrap gap-3">
          <ActionButton href="/studio?tool=chat" label="Resume in Studio" primary icon="play" />
          <ActionButton href="/projects" label="View Project" icon="folder" />
        </div>
      </div>
    </div>
  );
}

/* ---------- Quick Actions Widget ---------- */
function QuickActionsWidget() {
  const T = useTheme().resolvedColors;
  const actions = [
    { label: "Open Studio", href: "/studio", icon: "sparkles", color: T.accentColor },
    { label: "New Project", href: "/projects/new", icon: "plus", color: "#B6FF4A" },
    { label: "Start Mission", href: "/studio?tool=workflows", icon: "target", color: "#22D3EE" },
    { label: "Create Image", href: "/studio?tool=image", icon: "image", color: "#ec4899" },
    { label: "Mission Forge", href: "/studio?tool=workflows", icon: "layers", color: "#a855f7" },
    { label: "Connect GitHub", href: "/studio/github", icon: "git", color: "#f97316" },
    { label: "View Gallery", href: "/gallery", icon: "package", color: "#3b82f6" },
    { label: "Review Usage", href: "/wallet", icon: "wallet", color: "#B6FF4A" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {actions.map((a) => (
        <Link key={a.label} href={a.href} className="group relative flex flex-col items-center gap-3 p-4 rounded-xl transition-all hover:scale-[1.02] hover:-translate-y-0.5 overflow-hidden" style={{ backgroundColor: `${T.boxBg}80`, border: `1px solid ${a.color}25`, minHeight: 52 }}>
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: `radial-gradient(circle at top center, ${a.color}10 0%, transparent 60%)` }} />
          <div className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110" style={{ backgroundColor: `${a.color}15`, border: `1px solid ${a.color}35` }}>
            <Icon name={a.icon} size={18} style={{ color: a.color }} />
          </div>
          <span className="relative text-xs font-black" style={{ color: T.textColor }}>{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

/* ---------- Active Missions Widget ---------- */
function ActiveMissionsWidget({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const events = data?.events || [];
  const missions = events.filter((e) => e.event_type === "mission_created" || e.event_type === "mission_updated").slice(0, 3);

  if (loading) return <SkeletonCard />;
  if (missions.length === 0) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `${T.accentColor}10`, border: `1px solid ${T.accentColor}20` }}>
          <Icon name="target" size={20} style={{ color: T.accentColor }} />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No active Missions</p>
        <p className="text-xs opacity-50 mb-4">Start a Mission in Studio or Mission Forge and it will appear here.</p>
        <ActionButton href="/studio?tool=workflows" label="Open Mission Forge" icon="target" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {missions.map((m) => {
        const color = SEVERITY_COLORS[m.severity] || "#3b82f6";
        return (
          <div key={m.id} className="rounded-xl p-3" style={{ background: `${color}08`, borderLeft: `3px solid ${color}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>{m.title}</span>
              <span className="text-xs font-semibold uppercase" style={{ color }}>{m.severity}</span>
            </div>
            {m.description && <p className="text-xs opacity-50 truncate">{m.description}</p>}
            <div className="flex items-center gap-2 mt-1 text-xs opacity-30">
              <span>{timeAgo(m.created_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Needs Attention Widget ---------- */
function NeedsAttentionWidget({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const errorEvents = (data?.events || []).filter((e) => e.severity === "error" || e.severity === "critical" || e.severity === "warning").slice(0, 5);
  const accountErrors = (data?.accounts || []).filter((a) => a.last_error || a.status === "expired" || a.status === "missing_permission");

  const items = [
    ...errorEvents.map((e) => ({ id: e.id, severity: e.severity, message: e.title, time: e.created_at, area: e.provider, url: e.url })),
    ...accountErrors.map((a) => ({ id: a.id, severity: a.status === "expired" ? "warning" : "error", message: a.last_error || `${PROVIDER_LABELS[a.provider] || a.provider} needs attention`, time: a.last_synced_at, area: a.provider, url: null })),
  ];

  if (loading) return <SkeletonCard />;
  if (items.length === 0) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "#B6FF4A10", border: "1px solid #B6FF4A20" }}>
          <Icon name="check" size={18} style={{ color: "#B6FF4A" }} />
        </div>
        <p className="text-sm font-bold" style={{ color: T.headerColor }}>Everything looks good</p>
        <p className="text-xs opacity-40 mt-1">No errors or warnings right now.</p>
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
              <div className="flex items-center gap-2 mt-0.5 text-xs opacity-30">
                <span>{PROVIDER_LABELS[item.area] || item.area}</span>
                <span>· {timeAgo(item.time)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Recent Projects Widget ---------- */
function RecentProjectsWidget({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const allProjects = [...(data?.projects || []), ...(data?.legacyProjects || [])];

  if (loading) return <SkeletonCard />;
  if (allProjects.length === 0) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `${T.accentColor}10`, border: `1px solid ${T.accentColor}20` }}>
          <Icon name="folder" size={20} style={{ color: T.accentColor }} />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No projects yet</p>
        <p className="text-xs opacity-50 mb-4">Connect GitHub or start a blank project. LiTT will keep files, Missions, previews, and history together.</p>
        <ActionButton href="/studio/github" label="Connect GitHub" icon="git" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {allProjects.slice(0, 4).map((proj) => {
        const name = (proj as IntegrationProject).repository_full_name || (proj as LegacyProject).name || "Untitled";
        const branch = (proj as IntegrationProject).working_branch || (proj as IntegrationProject).default_branch || (proj as LegacyProject).working_branch || "main";
        const vercelUrl = (proj as IntegrationProject).vercel_production_url || null;
        const syncStatus = (proj as IntegrationProject).sync_status || (proj as LegacyProject).connection_status || "pending";
        return (
          <div key={proj.id} className="rounded-xl p-3 transition-all hover:opacity-80" style={{ background: `linear-gradient(135deg, ${T.boxBg} 0%, ${T.bgColor} 100%)`, border: `1px solid ${T.borderColor}30` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>{name}</span>
              <ConnectionPulse status={syncStatus} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs opacity-50 mb-2">
              <span className="flex items-center gap-1"><Icon name="branch" size={12} />{branch}</span>
              {vercelUrl && <span className="flex items-center gap-1" style={{ color: "#B6FF4A" }}><Icon name="rocket" size={12} />Live</span>}
              <span>Synced {timeAgo((proj as IntegrationProject).last_synced_at || (proj as LegacyProject).last_synced_at || null)}</span>
            </div>
            <div className="flex gap-2">
              <Link href="/studio?tool=chat" className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80" style={{ background: `${T.accentColor}20`, color: T.accentColor }}>Open Studio</Link>
              <Link href="/projects" className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80" style={{ background: `${T.borderColor}20`, color: T.textColor }}>View</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Connection Health Widget ---------- */
function ConnectionHealthWidget({ data, connections, loading }: {
  data: DashboardData | null; connections: ConnectionOverview[]; loading: boolean;
}) {
  const T = useTheme().resolvedColors;

  type Row = { label: string; status: string; detail: string; actionHref: string; actionLabel: string; category: string };
  const rows: Row[] = useMemo(() => {
    const result: Row[] = [];
    const providers = ["github", "vercel", "supabase"];
    for (const p of providers) {
      const acc = data?.accounts?.find((a) => a.provider === p);
      const conn = connections.find((c) => c.provider === p);
      if (acc || conn) {
        const status = acc?.status || conn?.status || "disconnected";
        const detail = acc?.provider_account_name || conn?.externalAccountName || (acc?.last_error ? acc.last_error.slice(0, 40) : "Connected");
        result.push({
          label: PROVIDER_LABELS[p] || p, status,
          detail: status === "connected" || status === "synced" ? detail : status === "disconnected" ? "Not connected" : detail,
          actionHref: p === "github" ? "/studio/github" : "/settings/connections",
          actionLabel: status === "connected" || status === "synced" ? "Manage" : "Connect",
          category: "Project",
        });
      } else {
        result.push({
          label: PROVIDER_LABELS[p] || p, status: "disconnected",
          detail: p === "github" ? "Needs repository" : "Not connected",
          actionHref: p === "github" ? "/studio/github" : "/settings/connections",
          actionLabel: p === "github" ? "Choose" : "Connect",
          category: "Project",
        });
      }
    }
    // AI providers
    result.push({ label: "Gemini", status: "ready", detail: "Ready", actionHref: "/settings", actionLabel: "Test", category: "AI" });
    result.push({ label: "OpenRouter", status: "ready", detail: "Ready", actionHref: "/settings", actionLabel: "Test", category: "AI" });
    // Terminal
    result.push({ label: "Terminal", status: "disconnected", detail: "Waiting for workspace", actionHref: "/settings?tab=cli", actionLabel: "Details", category: "Project" });
    // Meta (optional)
    const metaAcc = data?.accounts?.find((a) => a.provider === "meta");
    result.push({
      label: "Meta Developer", status: metaAcc?.status || "disconnected",
      detail: metaAcc?.provider_account_name || "Optional",
      actionHref: "/settings/connections", actionLabel: metaAcc ? "Manage" : "Connect", category: "Publishing",
    });
    return result;
  }, [data, connections]);

  if (loading) return <SkeletonCard />;

  const categories = ["Project", "AI", "Publishing"];
  return (
    <div className="space-y-4">
      {categories.map((cat) => (
        <div key={cat}>
          <div className="text-xs font-black uppercase tracking-wider opacity-30 mb-2">{cat}</div>
          <div className="space-y-1.5">
            {rows.filter((r) => r.category === cat).map((row) => {
              const color = STATUS_COLORS[row.status] || "#6b7280";
              return (
                <div key={row.label} className="flex items-center gap-3 rounded-lg p-2" style={{ background: `${T.borderColor}10` }}>
                  <ConnectionPulse status={row.status} />
                  <span className="text-sm font-bold flex-1" style={{ color: T.headerColor }}>{row.label}</span>
                  <span className="text-xs opacity-50 flex-1 truncate">{row.detail}</span>
                  <Link href={row.actionHref} className="rounded-lg px-2.5 py-1 text-xs font-bold transition-all hover:opacity-80" style={{ background: `${color}20`, color }}>{row.actionLabel}</Link>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Recent Creations Widget ---------- */
function RecentCreationsWidget({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const creations = (data?.events || []).filter((e) => e.event_type === "media_generated" || e.event_type === "artifact_created" || e.event_type === "image_generated").slice(0, 6);

  if (loading) return <SkeletonCard />;
  if (creations.length === 0) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "#ec489910", border: "1px solid #ec489920" }}>
          <Icon name="image" size={20} style={{ color: "#ec4899" }} />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No recent creations</p>
        <p className="text-xs opacity-50 mb-4">Generate an image, code snippet, or document in Studio and it will appear here.</p>
        <ActionButton href="/studio?tool=image" label="Create Image" icon="image" color="#ec4899" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {creations.map((c) => {
        const color = SEVERITY_COLORS[c.severity] || "#ec4899";
        return (
          <div key={c.id} className="rounded-xl p-3 transition-all hover:scale-[1.02]" style={{ background: `${T.boxBg}80`, border: `1px solid ${color}20` }}>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg mb-2" style={{ background: `${color}15` }}>
              <Icon name="image" size={16} style={{ color }} />
            </div>
            <div className="text-xs font-bold truncate" style={{ color: T.headerColor }}>{c.title}</div>
            <div className="text-xs opacity-30 mt-0.5">{timeAgo(c.created_at)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Usage Widget ---------- */
function UsageWidget({ wallet, usage, loading }: { wallet: WalletData | null; usage: UsageData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  if (loading) return <SkeletonCard />;
  const plan = usage?.summary?.plan || wallet?.plan || "Free";
  const balance = wallet?.balance ?? 0;
  const commands = usage?.summary?.totalCommands ?? 0;
  const generations = usage?.summary?.totalGenerations ?? 0;
  const tasks = usage?.summary?.totalAgentTasks ?? 0;
  const total = commands + generations + tasks;
  const topCategory = total > 0 ? (commands >= generations && commands >= tasks ? "Code generation" : generations >= tasks ? "Images" : "Agent tasks") : "No usage yet";

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-black uppercase tracking-wider opacity-30 mb-1">Plan</div>
        <div className="text-lg font-black" style={{ color: T.headerColor }}>{plan}</div>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="opacity-50">Monthly LiTBits</span>
          <span className="font-bold" style={{ color: T.accentColor }}>{balance.toLocaleString()} remaining</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: `${T.borderColor}20` }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (balance / 6000) * 100)}%`, background: T.accentColor }} />
        </div>
      </div>
      <div>
        <div className="text-xs font-black uppercase tracking-wider opacity-30 mb-1">Top usage</div>
        <div className="text-sm font-bold" style={{ color: T.headerColor }}>{topCategory}</div>
      </div>
      <div className="flex gap-2">
        <ActionButton href="/wallet" label="View Usage" icon="wallet" />
        {plan === "Free" && <ActionButton href="/pricing" label="Upgrade" icon="zap" color="#B6FF4A" />}
      </div>
    </div>
  );
}

/* ---------- Live Activity Widget ---------- */
function LiveActivityWidget({ data, loading, onMarkAllRead }: {
  data: DashboardData | null; loading: boolean; onMarkAllRead: () => void;
}) {
  const T = useTheme().resolvedColors;
  const events = useMemo(() => data?.events || [], [data]);

  const grouped = useMemo(() => {
    const now = new Date();
    const today: typeof events = [];
    const yesterday: typeof events = [];
    const earlier: typeof events = [];
    for (const e of events) {
      const d = new Date(e.created_at);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
      if (diffDays === 0) today.push(e);
      else if (diffDays === 1) yesterday.push(e);
      else earlier.push(e);
    }
    return { today, yesterday, earlier };
  }, [events]);



  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 rounded-lg animate-pulse bg-white/5" />)}</div>;
  }
  if (events.length === 0) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `${T.accentColor}10`, border: `1px solid ${T.accentColor}20` }}>
          <Icon name="activity" size={20} style={{ color: T.accentColor }} />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>No recent activity</p>
        <p className="text-xs opacity-40">Project, Mission, Studio, and connection activity will appear here.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {data && data.unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold" style={{ background: `${T.accentColor}15`, color: T.accentColor }}>
            <Icon name="pulse" size={12} />{data.unreadCount} unread
          </span>
          <button onClick={onMarkAllRead} className="text-xs font-semibold opacity-50 hover:opacity-80">Mark all read</button>
        </div>
      )}
      {[
        { label: "Today", items: grouped.today },
        { label: "Yesterday", items: grouped.yesterday },
        { label: "Earlier", items: grouped.earlier },
      ].filter((g) => g.items.length > 0).map((g) => (
        <div key={g.label}>
          <div className="text-xs font-black uppercase tracking-wider opacity-30 mb-2">{g.label}</div>
          <div className="space-y-1.5">
            {g.items.slice(0, 5).map((e) => {
              const color = SEVERITY_COLORS[e.severity] || "#3b82f6";
              return (
                <div key={e.id} className="flex items-start gap-3 rounded-lg p-2" style={{ background: e.read_at ? "transparent" : `${color}08`, borderLeft: `2px solid ${color}` }}>
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}15`, color }}>
                    <Icon name={e.event_type === "push" ? "commit" : e.event_type === "pull_request" ? "branch" : e.event_type === "workflow_run" ? "rocket" : "pulse"} size={12} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate" style={{ color: T.textColor }}>{e.title}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs opacity-30">
                      <span>{PROVIDER_LABELS[e.provider] || e.provider}</span>
                      <span>· {timeAgo(e.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- LiTT Suggestions Widget ---------- */
function LiTTSuggestionsWidget({ data, wallet, usage }: {
  data: DashboardData | null; wallet: WalletData | null; usage: UsageData | null;
}) {
  const T = useTheme().resolvedColors;
  const suggestions = useMemo(() => {
    const list: Array<{ reason: string; benefit: string; action: string; href: string }> = [];
    const projects = [...(data?.projects || []), ...(data?.legacyProjects || [])];
    if (projects.length === 0) {
      list.push({ reason: "Connect GitHub to unlock repository search.", benefit: "LiTT can scan your code and suggest improvements.", action: "Connect GitHub", href: "/studio/github" });
    }
    const hasGithub = data?.accounts?.some((a) => a.provider === "github");
    if (hasGithub && projects.length === 0) {
      list.push({ reason: "GitHub is connected but no repository is selected.", benefit: "Choose a repo to start working.", action: "Choose Repository", href: "/studio/github" });
    }
    if (usage && usage.summary.totalGenerations === 0) {
      list.push({ reason: "Your Image Studio has no saved project.", benefit: "Create your first image to see the creative engine.", action: "Create Image", href: "/studio?tool=image" });
    }
    if (wallet && typeof wallet.balance === "number" && wallet.balance < 1000) {
      list.push({ reason: "Your LiTBit balance is running low.", benefit: "Claim daily bonus or upgrade your plan.", action: "View Wallet", href: "/wallet" });
    }
    const errorEvents = (data?.events || []).filter((e) => e.severity === "error");
    if (errorEvents.length > 0) {
      list.push({ reason: `${errorEvents.length} recent error${errorEvents.length === 1 ? "" : "s"} need attention.`, benefit: "Fixing these will improve your workflow.", action: "Review Errors", href: "/dashboard" });
    }
    if (list.length === 0) {
      list.push({ reason: "Everything looks good. Start something new!", benefit: "Launch Studio to build your next idea.", action: "Open Studio", href: "/studio" });
    }
    return list.slice(0, 5);
  }, [data, wallet, usage]);

  return (
    <div className="space-y-2">
      {suggestions.map((s, i) => (
        <div key={i} className="rounded-xl p-3" style={{ background: `${T.accentColor}08`, borderLeft: `3px solid ${T.accentColor}` }}>
          <div className="text-xs font-bold mb-1" style={{ color: T.headerColor }}>{s.reason}</div>
          <div className="text-xs opacity-40 mb-2">{s.benefit}</div>
          <Link href={s.href} className="inline-flex items-center gap-1 text-xs font-bold transition-all hover:opacity-80" style={{ color: T.accentColor }}>
            {s.action} <Icon name="arrow" size={10} />
          </Link>
        </div>
      ))}
    </div>
  );
}

/* ---------- Deployments Widget ---------- */
function DeploymentsWidget({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const T = useTheme().resolvedColors;
  const deployments = (data?.deployments || []) as Deployment[];
  if (loading) return <SkeletonCard />;
  if (deployments.length === 0) return null;
  return (
    <div className="space-y-2">
      {deployments.slice(0, 4).map((dep) => {
        const isLive = dep.status === "live" || dep.status === "ready";
        const color = isLive ? "#B6FF4A" : dep.status === "failed" ? "#ef4444" : "#F97316";
        return (
          <div key={dep.id} className="flex items-center gap-3 rounded-lg p-2.5" style={{ background: `${color}08`, borderLeft: `2px solid ${color}` }}>
            <Icon name="rocket" size={14} style={{ color }} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold truncate" style={{ color: T.headerColor }}>{dep.project_name || "Deployment"}</div>
              <div className="text-xs opacity-30">{dep.environment || "Production"} · {timeAgo(dep.created_at || null)}</div>
            </div>
            <span className="text-xs font-semibold uppercase" style={{ color }}>{dep.status || "unknown"}</span>
            {dep.url && <a href={dep.url} target="_blank" rel="noopener noreferrer" className="opacity-40 hover:opacity-80"><Icon name="external" size={12} /></a>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Installed Capabilities Widget ---------- */
function CapabilitiesWidget({ caps, loading }: { caps: InstalledCap[]; loading: boolean }) {
  const T = useTheme().resolvedColors;
  if (loading) return <SkeletonCard />;
  if (caps.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs opacity-50 mb-3">No capabilities installed yet.</p>
        <ActionButton href="/marketplace" label="Browse Marketplace" icon="package" />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {caps.slice(0, 5).map((cap) => {
        const assistant = cap.compatible_assistants?.[0] || "litt";
        const color = assistant === "spark" ? "#a855f7" : "#22D3EE";
        return (
          <div key={cap.capability_key} className="flex items-center gap-3 rounded-lg p-2" style={{ background: `${T.borderColor}10` }}>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}15` }}>
              <Icon name="package" size={12} style={{ color }} />
            </div>
            <span className="text-xs font-bold flex-1 truncate" style={{ color: T.headerColor }}>{cap.name}</span>
            <span className="text-xs font-semibold" style={{ color: "#B6FF4A" }}>Ready</span>
          </div>
        );
      })}
      <Link href="/marketplace" className="inline-flex items-center gap-1 text-xs font-bold transition-all hover:opacity-80" style={{ color: T.accentColor }}>
        Manage Marketplace <Icon name="arrow" size={10} />
      </Link>
    </div>
  );
}

/* ---------- Assistants Widget ---------- */
function AssistantsWidget() {
  const T = useTheme().resolvedColors;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Link href="/studio?tool=chat" className="rounded-xl p-4 transition-all hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, #22D3EE10 0%, ${T.boxBg} 60%)`, border: "1px solid #22D3EE25" }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "#22D3EE15", border: "1px solid #22D3EE30" }}>
            <Icon name="bot" size={16} style={{ color: "#22D3EE" }} />
          </div>
          <ConnectionPulse status="connected" />
        </div>
        <div className="text-sm font-bold" style={{ color: T.headerColor }}>LiTT</div>
        <div className="text-xs opacity-50">AI operator · Ready</div>
      </Link>
      <Link href="/studio?tool=chat" className="rounded-xl p-4 transition-all hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, #a855f710 0%, ${T.boxBg} 60%)`, border: "1px solid #a855f725" }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "#a855f715", border: "1px solid #a855f730" }}>
            <Icon name="bot" size={16} style={{ color: "#a855f7" }} />
          </div>
          <ConnectionPulse status="connected" />
        </div>
        <div className="text-sm font-bold" style={{ color: T.headerColor }}>Spark</div>
        <div className="text-xs opacity-50">Creative partner · Ready</div>
      </Link>
    </div>
  );
}

/* ---------- Widget Customize Panel ---------- */
function CustomizePanel({ widgets, setWidgets, onClose }: {
  widgets: WidgetConfig[]; setWidgets: (w: WidgetConfig[]) => void; onClose: () => void;
}) {
  const T = useTheme().resolvedColors;
  const toggle = (id: WidgetId) => setWidgets(widgets.map((w) => w.id === id ? { ...w, visible: !w.visible } : w));
  const move = (id: WidgetId, dir: -1 | 1) => {
    const sorted = [...widgets].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((w) => w.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const tmp = sorted[idx].order;
    sorted[idx].order = sorted[swapIdx].order;
    sorted[swapIdx].order = tmp;
    setWidgets(sorted);
  };
  const reset = () => setWidgets(DEFAULT_WIDGETS.map((w) => ({ ...w })));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5" style={{ background: T.boxBg, border: `1px solid ${T.borderColor}40` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold" style={{ color: T.headerColor }}>Customize Dashboard</h3>
          <button onClick={onClose} className="opacity-50 hover:opacity-80"><Icon name="x" size={16} /></button>
        </div>
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {[...widgets].sort((a, b) => a.order - b.order).map((w) => (
            <div key={w.id} className="flex items-center gap-2 rounded-lg p-2" style={{ background: `${T.borderColor}10` }}>
              <button onClick={() => move(w.id, -1)} className="opacity-30 hover:opacity-80"><Icon name="chevron" size={14} style={{ transform: "rotate(-90deg)" }} /></button>
              <button onClick={() => move(w.id, 1)} className="opacity-30 hover:opacity-80"><Icon name="chevron" size={14} style={{ transform: "rotate(90deg)" }} /></button>
              <span className="text-xs font-bold flex-1" style={{ color: T.textColor }}>{w.label}</span>
              <button onClick={() => toggle(w.id)} className="rounded-lg p-1.5 transition-all" style={{ background: w.visible ? "#B6FF4A20" : `${T.borderColor}20`, color: w.visible ? "#B6FF4A" : T.textMuted }}>
                <Icon name={w.visible ? "eye" : "eyeOff"} size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-between">
          <button onClick={reset} className="text-xs font-semibold opacity-50 hover:opacity-80">Restore defaults</button>
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: T.accentColor, color: T.bgColor }}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main Component ---------- */
export function CommandCenter() {
  const T = useTheme().resolvedColors;
  const { user } = useAppUser();
  const { profile } = useProfile();
  const [data, setData] = useState<DashboardData | null>(null);
  const [connections, setConnections] = useState<ConnectionOverview[]>([]);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [installedCaps, setInstalledCaps] = useState<InstalledCap[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);

  /* Load widget preferences */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(WIDGET_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WidgetConfig[];
        if (Array.isArray(parsed) && parsed.length > 0) setWidgets(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  /* Save widget preferences */
  useEffect(() => {
    try { localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgets)); } catch { /* ignore */ }
  }, [widgets]);

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, connRes, walletRes, usageRes, capsRes] = await Promise.allSettled([
        fetch("/api/dashboard"), fetch("/api/connections"), fetch("/api/wallet"), fetch("/api/usage/stats"), fetch("/api/marketplace/installations"),
      ]);
      if (dashRes.status === "fulfilled" && dashRes.value.ok) {
        const json = await dashRes.value.json();
        setData(json);
      }
      if (connRes.status === "fulfilled" && connRes.value.ok) {
        const connJson = await connRes.value.json();
        setConnections(connJson.overview ?? []);
      }
      if (walletRes.status === "fulfilled" && walletRes.value.ok) {
        const wJson = await walletRes.value.json();
        setWallet({ balance: wJson.balance ?? null, plan: wJson.plan ?? "Free" });
      }
      if (usageRes.status === "fulfilled" && usageRes.value.ok) {
        const uJson = await usageRes.value.json();
        if (!uJson.demo) setUsage(uJson);
      }
      if (capsRes.status === "fulfilled" && capsRes.value.ok) {
        const cJson = await capsRes.value.json();
        setInstalledCaps(cJson.installations ?? cJson ?? []);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  /* SSE for live events */
  useEffect(() => {
    const es = new EventSource("/api/dashboard/events");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "events" && msg.events && data) {
          setData((prev) => prev ? { ...prev, events: [...msg.events, ...prev.events].slice(0, 50), unreadCount: prev.unreadCount + msg.events.length } : prev);
        }
      } catch { /* non-fatal */ }
    };
    return () => es.close();
  }, [data]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const instId = data?.installations?.[0]?.installation_id;
      if (!instId) { setError("No GitHub installation found"); return; }
      const res = await fetch("/api/connections/github/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installation_id: instId, full: true }) });
      if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/dashboard/events/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setData((prev) => prev ? { ...prev, unreadCount: 0, events: prev.events.map((e) => ({ ...e, read_at: e.read_at || new Date().toISOString() })) } : prev);
    } catch { /* non-fatal */ }
  };

  const displayName = profile?.displayName || user?.firstName || user?.username || "Member";

  /* Compute attention count for greeting */
  const attentionCount = useMemo(() => {
    const errorEvents = (data?.events || []).filter((e) => e.severity === "error" || e.severity === "critical" || e.severity === "warning").length;
    const accountErrors = (data?.accounts || []).filter((a) => a.last_error || a.status === "expired" || a.status === "missing_permission").length;
    return errorEvents + accountErrors;
  }, [data]);

  const greetingSubtext = loading
    ? "Loading your workspace…"
    : attentionCount > 0
      ? `LiTT found ${attentionCount} thing${attentionCount === 1 ? "" : "s"} worth your attention.`
      : "Everything is quiet. Start something new.";

  /* Widget ordering */
  const sortedWidgets = [...widgets].sort((a, b) => a.order - b.order);

  /* Render a widget by ID */
  const renderWidget = (id: WidgetId): React.ReactNode => {
    switch (id) {
      case "hero": return <HeroWidget data={data} loading={loading} />;
      case "quickActions": return <QuickActionsWidget />;
      case "missions": return <ActiveMissionsWidget data={data} loading={loading} />;
      case "attention": return <NeedsAttentionWidget data={data} loading={loading} />;
      case "projects": return <RecentProjectsWidget data={data} loading={loading} />;
      case "connections": return <ConnectionHealthWidget data={data} connections={connections} loading={loading} />;
      case "creations": return <RecentCreationsWidget data={data} loading={loading} />;
      case "usage": return <UsageWidget wallet={wallet} usage={usage} loading={loading} />;
      case "activity": return <LiveActivityWidget data={data} loading={loading} onMarkAllRead={handleMarkAllRead} />;
      case "suggestions": return <LiTTSuggestionsWidget data={data} wallet={wallet} usage={usage} />;
      case "deployments": return <DeploymentsWidget data={data} loading={loading} />;
      case "capabilities": return <CapabilitiesWidget caps={installedCaps} loading={loading} />;
      case "assistants": return <AssistantsWidget />;
      default: return null;
    }
  };

  /* Column spans for desktop grid */
  const colSpanFor = (id: WidgetId): string => {
    const wide: WidgetId[] = ["hero", "quickActions"];
    const medium: WidgetId[] = ["missions", "projects", "creations", "activity"];
    if (wide.includes(id)) return "lg:col-span-12";
    if (medium.includes(id)) return "lg:col-span-8";
    return "lg:col-span-4";
  };

  /* Whether to wrap in WidgetShell (hero and quickActions are full-width, no shell) */
  const isFullWidth = (id: WidgetId) => id === "hero" || id === "quickActions";

  return (
    <div className="min-h-screen backdrop-blur-sm" style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}>
      <div className="mx-auto max-w-7xl p-4 lg:p-8">
        {/* Personal Greeting + Actions */}
        <div className="mb-6 flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between" style={{ background: `linear-gradient(135deg, ${T.accentColor}08 0%, transparent 70%)`, borderBottom: `1px solid ${T.borderColor}20` }}>
          <div>
            <h1 className="text-2xl font-black lg:text-3xl" style={{ color: T.headerColor }}>
              {getGreeting()}, {displayName}
            </h1>
            <p className="text-sm mt-1" style={{ color: T.textMuted }}>{greetingSubtext}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCustomize(true)} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80" style={{ background: `${T.borderColor}20`, color: T.textColor, border: `1px solid ${T.borderColor}40` }}>
              <Icon name="settings" size={14} />Customize
            </button>
            <button onClick={handleSync} disabled={syncing} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80 disabled:opacity-40" style={{ background: `${T.accentColor}20`, color: T.accentColor, border: `1px solid ${T.accentColor}30` }}>
              <Icon name="sync" size={14} className={syncing ? "animate-spin" : ""} />{syncing ? "Syncing…" : "Sync"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl p-3 text-sm" style={{ background: "#ef444410", color: "#ef4444", border: "1px solid #ef444430" }}>
            <Icon name="alert" size={14} className="inline mr-2" />{error}
          </div>
        )}

        {/* Widget Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {sortedWidgets.filter((w) => w.visible).map((w) => {
            const content = renderWidget(w.id);
            if (content === null) return null;
            if (isFullWidth(w.id)) {
              return <div key={w.id} className={colSpanFor(w.id)}>{content}</div>;
            }
            return (
              <WidgetShell key={w.id} title={w.label} colSpan={colSpanFor(w.id)}>
                {content}
              </WidgetShell>
            );
          })}
        </div>
      </div>

      {showCustomize && (
        <CustomizePanel widgets={widgets} setWidgets={setWidgets} onClose={() => setShowCustomize(false)} />
      )}

      <FloatingVoiceButton />
    </div>
  );
}
