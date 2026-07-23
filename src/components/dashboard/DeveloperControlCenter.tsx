"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
    pr: "M6 3v12 M18 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z M6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z M6 21h12",
    issue: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 8v4 M12 16h.01",
    build: "M3 21h18 M5 21V7l8-4v18 M19 21V11l-6-4 M9 9v.01 M9 12v.01 M9 15v.01 M9 18v.01",
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
    dots: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
    link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      <path d={paths[name] || ""} />
    </svg>
  );
}

/* ---------- Types ---------- */
type IntegrationAccount = {
  id: string;
  provider: string;
  provider_account_id: string | null;
  provider_account_name: string | null;
  status: string;
  last_connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
};

type IntegrationProject = {
  id: string;
  provider: string;
  repository_id: number | null;
  repository_full_name: string | null;
  repository_html_url: string | null;
  repository_private: boolean;
  default_branch: string | null;
  working_branch: string | null;
  latest_commit_sha: string | null;
  latest_commit_message: string | null;
  latest_commit_author: string | null;
  latest_commit_date: string | null;
  open_prs_count: number;
  open_issues_count: number;
  github_actions_status: Record<string, unknown>;
  vercel_project_id: string | null;
  vercel_deployment_url: string | null;
  vercel_production_url: string | null;
  vercel_status: string | null;
  last_synced_at: string | null;
  sync_status: string;
  sync_error: string | null;
};

type IntegrationEvent = {
  id: string;
  provider: string;
  event_type: string;
  title: string;
  description: string | null;
  severity: string;
  actor: string | null;
  url: string | null;
  read_at: string | null;
  created_at: string;
};

type LegacyProject = {
  id: string;
  name: string;
  status: string;
  owner?: string;
  repository?: string;
  working_branch?: string;
  connection_status: string;
  repository_full_name?: string;
  repository_html_url?: string;
  repository_private?: boolean;
  selected_branch?: string;
  connected_at?: string;
  last_synced_at?: string;
};

type DashboardData = {
  accounts: IntegrationAccount[];
  projects: IntegrationProject[];
  legacyProjects: LegacyProject[];
  events: IntegrationEvent[];
  unreadCount: number;
  installations: Array<{ installation_id: number; user_id: string; created_at: string }>;
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

const STATUS_COLORS: Record<string, string> = {
  connected: "#22c55e",
  degraded: "#f59e0b",
  expired: "#f97316",
  missing_permission: "#ef4444",
  offline: "#6b7280",
  disconnected: "#6b7280",
  synced: "#22c55e",
  syncing: "#3b82f6",
  behind: "#f59e0b",
  error: "#ef4444",
  pending: "#6b7280",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "#3b82f6",
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  critical: "#dc2626",
};

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  meta: "Meta Developer",
  vercel: "Vercel",
  supabase: "Supabase",
};

/* ---------- Sub-components ---------- */

function ConnectionPulse({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "#6b7280";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === "connected" || status === "synced" ? (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

function ConnectionCard({ account, onReconnect, onDisconnect }: {
  account: IntegrationAccount;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const T = useTheme().resolvedColors;
  const color = STATUS_COLORS[account.status] || "#6b7280";
  const label = PROVIDER_LABELS[account.provider] || account.provider;

  return (
    <div
      className="rounded-xl p-4 transition-all hover:scale-[1.01]"
      style={{
        background: `linear-gradient(135deg, ${color}10 0%, ${T.boxBg} 60%)`,
        border: `1px solid ${color}30`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ConnectionPulse status={account.status} />
          <span className="text-sm font-bold" style={{ color: T.headerColor }}>
            {label}
          </span>
        </div>
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color }}
        >
          {account.status.replace(/_/g, " ")}
        </span>
      </div>
      <div className="text-xs opacity-60 mb-3">
        {account.provider_account_name || `Account ${account.provider_account_id}`}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="opacity-50">
          Synced {timeAgo(account.last_synced_at)}
        </span>
        <div className="flex gap-2">
          <button
            onClick={onReconnect}
            className="rounded-lg px-2 py-1 text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: `${T.accentColor}20`, color: T.accentColor }}
          >
            <Icon name="refresh" size={12} className="inline mr-1" />
            Refresh
          </button>
          <button
            onClick={onDisconnect}
            className="rounded-lg px-2 py-1 text-xs font-semibold opacity-50 transition-all hover:opacity-80"
            style={{ background: `${T.borderColor}20`, color: T.textColor }}
          >
            Disconnect
          </button>
        </div>
      </div>
      {account.last_error && (
        <div
          className="mt-2 rounded-lg p-2 text-xs"
          style={{ background: "#ef444410", color: "#ef4444" }}
        >
          <Icon name="alert" size={12} className="inline mr-1" />
          {account.last_error}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onSync }: {
  project: IntegrationProject;
  onSync: () => void;
}) {
  const T = useTheme().resolvedColors;
  const actions = project.github_actions_status as Record<string, unknown>;
  const buildConclusion = (actions?.conclusion as string) || null;
  const buildStatus = (actions?.status as string) || null;
  const buildColor = buildConclusion === "failure" ? "#ef4444" : buildConclusion === "success" ? "#22c55e" : buildStatus === "in_progress" ? "#3b82f6" : "#6b7280";

  const syncColor = STATUS_COLORS[project.sync_status] || "#6b7280";

  return (
    <div
      className="rounded-xl p-4 transition-all hover:scale-[1.005]"
      style={{
        background: `linear-gradient(135deg, ${T.boxBg} 0%, ${T.bgColor} 100%)`,
        border: `1px solid ${T.borderColor}40`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="folder" size={14} className="opacity-50" />
            <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>
              {project.repository_full_name || "Unknown repo"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs opacity-50">
            <span className="flex items-center gap-1">
              <Icon name="branch" size={12} />
              {project.working_branch || project.default_branch || "main"}
            </span>
            {project.repository_private && (
              <span style={{ color: "#f59e0b" }}>private</span>
            )}
          </div>
        </div>
        <ConnectionPulse status={project.sync_status} />
      </div>

      {/* Latest commit */}
      {project.latest_commit_sha && (
        <div className="mb-3 rounded-lg p-2 text-xs" style={{ background: `${T.borderColor}15` }}>
          <div className="flex items-center gap-2 mb-1">
            <Icon name="commit" size={12} className="opacity-50" />
            <code className="font-mono opacity-70">
              {project.latest_commit_sha.slice(0, 7)}
            </code>
            <span className="opacity-40">·</span>
            <span className="opacity-50">{project.latest_commit_author}</span>
            <span className="opacity-30 ml-auto">{timeAgo(project.latest_commit_date)}</span>
          </div>
          <p className="truncate opacity-70">
            {project.latest_commit_message}
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3 text-xs">
        {/* PRs */}
        <span className="flex items-center gap-1" style={{ color: project.open_prs_count > 0 ? "#a855f7" : T.textMuted || "#888" }}>
          <Icon name="pr" size={14} />
          {project.open_prs_count} PR{project.open_prs_count === 1 ? "" : "s"}
        </span>
        {/* Issues */}
        <span className="flex items-center gap-1" style={{ color: project.open_issues_count > 0 ? "#3b82f6" : T.textMuted || "#888" }}>
          <Icon name="issue" size={14} />
          {project.open_issues_count} issue{project.open_issues_count === 1 ? "" : "s"}
        </span>
        {/* Build status */}
        <span className="flex items-center gap-1" style={{ color: buildColor }}>
          <Icon name="build" size={14} />
          {buildConclusion || buildStatus || "No builds"}
        </span>
      </div>

      {/* Deployment */}
      {project.vercel_production_url && (
        <a
          href={project.vercel_production_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 flex items-center gap-2 rounded-lg p-2 text-xs transition-all hover:opacity-80"
          style={{ background: "#22c55e10", color: "#22c55e" }}
        >
          <Icon name="rocket" size={12} />
          <span className="truncate">{project.vercel_production_url.replace(/^https?:\/\//, "")}</span>
          <Icon name="external" size={12} className="ml-auto" />
        </a>
      )}

      {/* Last sync */}
      <div className="mb-3 flex items-center justify-between text-xs opacity-40">
        <span className="flex items-center gap-1">
          <Icon name="clock" size={12} />
          Last synced {timeAgo(project.last_synced_at)}
        </span>
        {project.sync_error && (
          <span style={{ color: "#ef4444" }}>
            <Icon name="alert" size={12} className="inline mr-1" />
            {project.sync_error.slice(0, 40)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/studio"
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
          style={{ background: `${T.accentColor}20`, color: T.accentColor }}
        >
          <Icon name="external" size={12} className="inline mr-1" />
          Open Studio
        </Link>
        <a
          href={project.repository_html_url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
          style={{ background: `${T.borderColor}20`, color: T.textColor }}
        >
          <Icon name="git" size={12} className="inline mr-1" />
          Repository
        </a>
        <button
          onClick={onSync}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
          style={{ background: `${syncColor}20`, color: syncColor }}
        >
          <Icon name="sync" size={12} className="inline mr-1" />
          Sync Now
        </button>
        {project.vercel_production_url && (
          <a
            href={project.vercel_production_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: "#22c55e15", color: "#22c55e" }}
          >
            <Icon name="rocket" size={12} className="inline mr-1" />
            View Deployment
          </a>
        )}
      </div>
    </div>
  );
}

function LegacyProjectCard({ project }: { project: LegacyProject }) {
  const T = useTheme().resolvedColors;
  return (
    <div
      className="rounded-xl p-4 transition-all"
      style={{
        background: `linear-gradient(135deg, ${T.boxBg} 0%, ${T.bgColor} 100%)`,
        border: `1px solid ${T.borderColor}40`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>
          {project.name}
        </span>
        <ConnectionPulse status={project.connection_status} />
      </div>
      {project.repository_full_name && (
        <div className="text-xs opacity-50 mb-2">
          <Icon name="folder" size={12} className="inline mr-1" />
          {project.repository_full_name}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs opacity-50 mb-3">
        {project.working_branch && (
          <span className="flex items-center gap-1">
            <Icon name="branch" size={12} />
            {project.working_branch}
          </span>
        )}
        <span>Synced {timeAgo(project.last_synced_at ?? project.connected_at ?? null)}</span>
      </div>
      <div className="flex gap-2">
        <Link
          href="/studio"
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
          style={{ background: `${T.accentColor}20`, color: T.accentColor }}
        >
          Open Studio
        </Link>
        {project.repository_html_url && (
          <a
            href={project.repository_html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: `${T.borderColor}20`, color: T.textColor }}
          >
            <Icon name="git" size={12} className="inline mr-1" />
            Repository
          </a>
        )}
      </div>
    </div>
  );
}

function ActivityItem({ event }: { event: IntegrationEvent }) {
  const T = useTheme().resolvedColors;
  const color = SEVERITY_COLORS[event.severity] || "#3b82f6";
  const providerLabel = PROVIDER_LABELS[event.provider] || event.provider;

  return (
    <div
      className="flex items-start gap-3 rounded-lg p-2.5 transition-all hover:opacity-80"
      style={{ background: event.read_at ? "transparent" : `${color}08` }}
    >
      <div
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}15`, color }}
      >
        <Icon
          name={
            event.event_type === "push" ? "commit" :
            event.event_type === "pull_request" ? "pr" :
            event.event_type === "workflow_run" ? "build" :
            event.event_type === "issues" ? "issue" :
            event.event_type === "repository" ? "folder" :
            event.event_type.startsWith("meta_") ? "activity" :
            "pulse"
          }
          size={14}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold truncate" style={{ color: T.textColor }}>
            {event.title}
          </span>
          {!event.read_at && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          )}
        </div>
        {event.description && (
          <p className="text-xs opacity-50 truncate mt-0.5">{event.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1 text-xs opacity-30">
          <span>{providerLabel}</span>
          {event.actor && <span>· {event.actor}</span>}
          <span>· {timeAgo(event.created_at)}</span>
          {event.url && (
            <a href={event.url} target="_blank" rel="noopener noreferrer" className="ml-auto hover:opacity-60">
              <Icon name="external" size={10} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl p-4 animate-pulse" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="h-4 w-32 rounded bg-white/5 mb-3" />
      <div className="h-3 w-48 rounded bg-white/5 mb-2" />
      <div className="h-3 w-24 rounded bg-white/5 mb-4" />
      <div className="flex gap-2">
        <div className="h-6 w-20 rounded bg-white/5" />
        <div className="h-6 w-20 rounded bg-white/5" />
      </div>
    </div>
  );
}

/* ---------- Main Component ---------- */
export function DeveloperControlCenter() {
  const T = useTheme().resolvedColors;
  const { user } = useAppUser();
  const { profile } = useProfile();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Array<{ step: string; status: string; detail: string }> | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const eventsRef = useRef<HTMLDivElement>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // SSE for live events
  useEffect(() => {
    const es = new EventSource("/api/dashboard/events");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "events" && msg.events && data) {
          setData((prev) => prev ? {
            ...prev,
            events: [...msg.events, ...prev.events].slice(0, 50),
            unreadCount: prev.unreadCount + msg.events.length,
          } : prev);
        }
      } catch {
        // Non-fatal
      }
    };
    return () => es.close();
  }, [data]);

  const handleSync = async (installationId?: number) => {
    setSyncing(true);
    try {
      const instId = installationId || data?.installations?.[0]?.installation_id;
      if (!instId) {
        setError("No GitHub installation found");
        return;
      }
      const res = await fetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installation_id: instId, full: true }),
      });
      if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setShowDiagnostics(true);
    try {
      const instId = data?.installations?.[0]?.installation_id;
      const url = instId ? `/api/github/diagnostics?installation_id=${instId}` : "/api/github/diagnostics";
      const res = await fetch(url);
      const json = await res.json();
      setDiagnostics(json.steps || []);
    } catch (err) {
      setDiagnostics([{ step: "diagnostics", status: "fail", detail: err instanceof Error ? err.message : "Failed" }]);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/dashboard/events/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setData((prev) => prev ? { ...prev, unreadCount: 0, events: prev.events.map((e) => ({ ...e, read_at: e.read_at || new Date().toISOString() })) } : prev);
    } catch {
      // Non-fatal
    }
  };

  const displayName = profile?.displayName || user?.firstName || user?.username || "Developer";

  const allProjects = [
    ...(data?.projects || []),
    ...(data?.legacyProjects || []).map((lp) => ({ _legacy: true, ...lp })),
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="mx-auto max-w-7xl p-4 lg:p-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider opacity-40 mb-1">
              LiTTree-LabStudios™ · Developer Control Center
            </div>
            <h1 className="text-2xl font-black lg:text-3xl" style={{ color: T.headerColor }}>
              Welcome back, {displayName}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSync()}
              disabled={syncing}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80 disabled:opacity-40"
              style={{ background: `${T.accentColor}20`, color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
            >
              <Icon name="sync" size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync All"}
            </button>
            <button
              onClick={handleRunDiagnostics}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80"
              style={{ background: `${T.borderColor}20`, color: T.textColor, border: `1px solid ${T.borderColor}40` }}
            >
              <Icon name="settings" size={14} />
              Diagnostics
            </button>
          </div>
        </div>

        {error && (
          <div
            className="mb-6 rounded-xl p-3 text-sm"
            style={{ background: "#ef444410", color: "#ef4444", border: "1px solid #ef444430" }}
          >
            <Icon name="alert" size={14} className="inline mr-2" />
            {error}
          </div>
        )}

        {/* Diagnostics drawer */}
        {showDiagnostics && (
          <div
            className="mb-6 rounded-xl p-4"
            style={{ background: T.boxBg, border: `1px solid ${T.borderColor}40` }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold" style={{ color: T.headerColor }}>
                GitHub Sync Diagnostics
              </h3>
              <button onClick={() => setShowDiagnostics(false)} className="opacity-50 hover:opacity-80">
                <Icon name="x" size={16} />
              </button>
            </div>
            {diagnosticsLoading ? (
              <div className="flex items-center gap-2 text-sm opacity-50">
                <Icon name="refresh" size={14} className="animate-spin" />
                Running diagnostics…
              </div>
            ) : diagnostics ? (
              <div className="space-y-2">
                {diagnostics.map((diag, i) => {
                  const color = diag.status === "pass" ? "#22c55e" : diag.status === "fail" ? "#ef4444" : "#f59e0b";
                  return (
                    <div key={i} className="flex items-start gap-3 text-xs">
                      <span
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                        style={{ background: `${color}20`, color }}
                      >
                        {diag.status === "pass" ? <Icon name="check" size={12} /> : diag.status === "fail" ? <Icon name="x" size={12} /> : <Icon name="alert" size={12} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold" style={{ color: T.textColor }}>
                          {diag.step.replace(/_/g, " ")}
                        </div>
                        <div className="opacity-50">{diag.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

        {/* Connection Health */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider opacity-40">
            Connection Health
          </h2>
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : (data?.accounts && data.accounts.length > 0) ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.accounts.map((acc) => (
                <ConnectionCard
                  key={acc.id}
                  account={acc}
                  onReconnect={() => handleSync()}
                  onDisconnect={async () => {
                    // Disconnect handler — could be provider-specific
                  }}
                />
              ))}
              {/* Show placeholder for missing providers */}
              {["github", "meta", "vercel", "supabase"]
                .filter((p) => !data.accounts.some((a) => a.provider === p))
                .map((p) => (
                  <div
                    key={p}
                    className="rounded-xl p-4 opacity-40"
                    style={{ background: T.boxBg, border: `1px dashed ${T.borderColor}40` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <ConnectionPulse status="disconnected" />
                      <span className="text-sm font-bold" style={{ color: T.headerColor }}>
                        {PROVIDER_LABELS[p]}
                      </span>
                    </div>
                    <div className="text-xs opacity-60">Not connected</div>
                    {p === "github" && (
                      <Link href="/studio/github" className="mt-2 inline-block text-xs font-semibold" style={{ color: T.accentColor }}>
                        Connect →
                      </Link>
                    )}
                    {p === "meta" && (
                      <Link href="/settings/connections" className="mt-2 inline-block text-xs font-semibold" style={{ color: T.accentColor }}>
                        Connect →
                      </Link>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["github", "meta", "vercel", "supabase"].map((p) => (
                <div
                  key={p}
                  className="rounded-xl p-4 opacity-40"
                  style={{ background: T.boxBg, border: `1px dashed ${T.borderColor}40` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ConnectionPulse status="disconnected" />
                    <span className="text-sm font-bold" style={{ color: T.headerColor }}>
                      {PROVIDER_LABELS[p]}
                    </span>
                  </div>
                  <div className="text-xs opacity-60">Not connected</div>
                  {p === "github" && (
                    <Link href="/studio/github" className="mt-2 inline-block text-xs font-semibold" style={{ color: T.accentColor }}>
                      Connect →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Main grid: Projects + Activity */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Projects — takes 2 columns on desktop */}
          <section className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider opacity-40">
                Live Projects
              </h2>
              <Link
                href="/studio/github"
                className="text-xs font-semibold transition-all hover:opacity-80"
                style={{ color: T.accentColor }}
              >
                <Icon name="plug" size={12} className="inline mr-1" />
                Connect Repository
              </Link>
            </div>
            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : allProjects.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {data?.projects.map((proj) => (
                  <ProjectCard
                    key={proj.id}
                    project={proj}
                    onSync={() => handleSync()}
                  />
                ))}
                {data?.legacyProjects.map((proj) => (
                  <LegacyProjectCard key={proj.id} project={proj} />
                ))}
              </div>
            ) : (
              <div
                className="rounded-xl p-8 text-center"
                style={{ background: T.boxBg, border: `1px dashed ${T.borderColor}40` }}
              >
                <Icon name="folder" size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm opacity-50 mb-4">
                  No projects connected yet. Connect a GitHub repository to get started.
                </p>
                <Link
                  href="/studio/github"
                  className="inline-block rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80"
                  style={{ background: `${T.accentColor}20`, color: T.accentColor }}
                >
                  <Icon name="git" size={14} className="inline mr-2" />
                  Connect GitHub Repository
                </Link>
              </div>
            )}
          </section>

          {/* Live Activity — takes 1 column on desktop */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider opacity-40">
                Live Activity
              </h2>
              {data && data.unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs font-semibold opacity-50 transition-all hover:opacity-80"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div
              ref={eventsRef}
              className="space-y-2 overflow-y-auto rounded-xl p-3"
              style={{
                background: T.boxBg,
                border: `1px solid ${T.borderColor}30`,
                maxHeight: "calc(100vh - 200px)",
              }}
            >
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-lg animate-pulse bg-white/5" />
                  ))}
                </div>
              ) : data?.events && data.events.length > 0 ? (
                data.events.map((event) => <ActivityItem key={event.id} event={event} />)
              ) : (
                <div className="py-8 text-center">
                  <Icon name="activity" size={24} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs opacity-40">No activity yet</p>
                  <p className="text-xs opacity-30 mt-1">
                    Events from GitHub, Meta, and agents will appear here in real time.
                  </p>
                </div>
              )}
            </div>
            {data && data.unreadCount > 0 && (
              <div className="mt-2 text-center">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                  style={{ background: `${T.accentColor}15`, color: T.accentColor }}
                >
                  <Icon name="pulse" size={12} />
                  {data.unreadCount} unread
                </span>
              </div>
            )}
          </section>
        </div>

        {/* AI Crew section */}
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider opacity-40">
            AI Crew
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Link
              href="/agents"
              className="rounded-xl p-4 transition-all hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, ${T.accentColor}10 0%, ${T.boxBg} 60%)`, border: `1px solid ${T.accentColor}25` }}
            >
              <Icon name="bot" size={20} className="mb-2" style={{ color: T.accentColor }} />
              <div className="text-sm font-bold" style={{ color: T.headerColor }}>Crew Room</div>
              <div className="text-xs opacity-50">Direct LiTT, Spark, and agents</div>
            </Link>
            <Link
              href="/studio"
              className="rounded-xl p-4 transition-all hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, #a855f710 0%, ${T.boxBg} 60%)`, border: "1px solid #a855f725" }}
            >
              <Icon name="rocket" size={20} className="mb-2" style={{ color: "#a855f7" }} />
              <div className="text-sm font-bold" style={{ color: T.headerColor }}>Studio</div>
              <div className="text-xs opacity-50">Build, generate, and ship</div>
            </Link>
            <Link
              href="/studio?tool=build"
              className="rounded-xl p-4 transition-all hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, #3b82f610 0%, ${T.boxBg} 60%)`, border: "1px solid #3b82f625" }}
            >
              <Icon name="terminal" size={20} className="mb-2" style={{ color: "#3b82f6" }} />
              <div className="text-sm font-bold" style={{ color: T.headerColor }}>Build Command</div>
              <div className="text-xs opacity-50">Plan and scaffold projects</div>
            </Link>
            <Link
              href="/settings/connections"
              className="rounded-xl p-4 transition-all hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, #22c55e10 0%, ${T.boxBg} 60%)`, border: "1px solid #22c55e25" }}
            >
              <Icon name="plug" size={20} className="mb-2" style={{ color: "#22c55e" }} />
              <div className="text-sm font-bold" style={{ color: T.headerColor }}>Connections</div>
              <div className="text-xs opacity-50">Manage integrations</div>
            </Link>
          </div>
        </section>
      </div>

      {/* Mobile sticky command bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t py-2 lg:hidden"
        style={{ background: T.bgColor, borderColor: `${T.borderColor}40` }}
      >
        <Link href="/dashboard" className="flex flex-col items-center gap-0.5 text-xs" style={{ color: T.accentColor }}>
          <Icon name="activity" size={18} />
          <span>Dashboard</span>
        </Link>
        <Link href="/studio" className="flex flex-col items-center gap-0.5 text-xs opacity-60">
          <Icon name="rocket" size={18} />
          <span>Studio</span>
        </Link>
        <Link href="/agents" className="flex flex-col items-center gap-0.5 text-xs opacity-60">
          <Icon name="bot" size={18} />
          <span>Crew</span>
        </Link>
        <Link href="/settings/connections" className="flex flex-col items-center gap-0.5 text-xs opacity-60">
          <Icon name="settings" size={18} />
          <span>Settings</span>
        </Link>
      </div>
      <FloatingVoiceButton />
    </div>
  );
}
