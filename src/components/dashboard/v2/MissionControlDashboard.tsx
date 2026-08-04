"use client";

/**
 * MissionControlDashboard — LiTT Mission Control.
 *
 * Replaces the old stacked DashboardV2 layout. Wide operational workspace
 * (max-w-[1680px]) with:
 *   - 6-column metric strip
 *   - large left operational column (project runtime, mission queue, activity)
 *   - right control rail (system status, owner pulse, operating rules)
 *
 * Fetches from /api/dashboard/mission-control (aggregated server-side).
 * Owner data (growth, revenue) only renders when ownerMode === true.
 *
 * Preserves the global Media Hub via MediaHubProvider.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { MediaNowPlayingCard } from "@/components/media/MediaNowPlayingCard";
import { Icon } from "./dashboard-v2-utils";
import type { MissionControlResponse } from "@/lib/mission-control";
import { useDashboardLayout } from "@/lib/dashboard/layout-store";
import { getWidgetDefinition } from "@/lib/dashboard/widget-registry";
import { WidgetLibraryDrawer } from "@/components/dashboard/widgets/WidgetLibraryDrawer";
import {
  LiTTQuickAskWidget,
  MissionQueueWidget,
  CurrentProjectWidget,
  ProjectRuntimeWidget,
  PendingApprovalsWidget,
  RecentActivityWidget,
  RecentCreationsWidget,
  MyGalleryWidget,
  TrendingGalleryWidget,
  DiscoverFeedWidget,
  MusicPlayerWidget,
  LiTTBitsWidget,
  NotificationsWidget,
  DeploymentsWidget,
  SavedItemsWidget,
  OwnerMetricWidget,
  SystemHealthWidget,
  AuditEventsWidget,
} from "@/components/dashboard/widgets/DashboardWidgets";
import type { RecentCreation } from "@/lib/dashboard/recent-creations";
import type { GalleryWidgetData } from "@/lib/dashboard/gallery-widget-data";
import type { DiscoverFeedItem } from "@/lib/dashboard/discover-widget-data";

// ---------------------------------------------------------------------------
// Design tokens — deep black-violet matching the Studio shell
// ---------------------------------------------------------------------------

const D = {
  bg: "transparent",
  bgGradient:
    "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,58,237,0.18), transparent 60%), radial-gradient(circle at 85% 20%, rgba(168,85,247,0.08), transparent 35%), radial-gradient(circle at 10% 80%, rgba(99,102,241,0.06), transparent 40%), transparent",
  surface: "rgba(255,255,255,0.03)",
  surfaceHover: "rgba(255,255,255,0.06)",
  border: "rgba(168,85,247,0.15)",
  borderActive: "rgba(168,85,247,0.4)",
  accent: "#a970ff",
  accentGreen: "#B6FF4A",
  accentAmber: "#F97316",
  accentRed: "#ef4444",
  accentCyan: "#65f4ff",
  textPrimary: "#eef4ff",
  textMuted: "rgba(238,244,255,0.5)",
  textDim: "rgba(238,244,255,0.3)",
  glow: "0 0 24px rgba(168,85,247,0.15)",
  glowGreen: "0 0 20px rgba(182,255,74,0.12)",
};

// ---------------------------------------------------------------------------
// State styling
// ---------------------------------------------------------------------------

const STATE_COLOR: Record<string, string> = {
  healthy: D.accentGreen,
  connected: D.accentGreen,
  authorized: D.accentAmber,
  linked: D.accentAmber,
  live: D.accentGreen,
  operational: D.accentGreen,
  configured: D.accentAmber,
  checking: D.accentCyan,
  degraded: D.accentAmber,
  rate_limited: D.accentAmber,
  reconnect_required: D.accentAmber,
  unauthorized: D.accentRed,
  unavailable: D.accentRed,
  failed: D.accentRed,
  disconnected: D.textDim,
  not_connected: D.textDim,
  not_configured: D.textDim,
  missing: D.textDim,
};

const MISSION_STATE_COLOR: Record<string, string> = {
  created: D.textMuted,
  inspecting: D.accentCyan,
  planning: D.accent,
  awaiting_approval: D.accentAmber,
  executing: D.accentGreen,
  verifying: D.accentCyan,
  completed: D.accentGreen,
  failed: D.accentRed,
  paused: D.accentAmber,
  cancelled: D.textDim,
};

function stateLabel(state: string): string {
  return state.replaceAll("_", " ");
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  detail,
  icon,
  highlight = false,
  statusColor,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: string;
  highlight?: boolean;
  statusColor?: string;
}) {
  const isEmpty = value === "No project" || value === "Unavailable" || value === "None" || value === 0 && label !== "Active Missions" && label !== "Needs Attention";
  const dotColor = statusColor ?? (isEmpty ? D.textDim : highlight ? D.accentGreen : D.accent);
  return (
    <div
      className="group rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02]"
      style={{
        background: highlight ? `${D.accent}08` : D.surface,
        borderColor: highlight ? `${D.accent}30` : D.border,
        boxShadow: highlight ? D.glow : "none",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.18em]"
          style={{ color: isEmpty ? D.textDim : D.textMuted }}
        >
          <span
            className="h-2 w-2 rounded-full transition-all group-hover:scale-125"
            style={{
              backgroundColor: dotColor,
              boxShadow: `0 0 6px ${dotColor}80`,
            }}
          />
          {label}
        </span>
        <Icon
          name={icon}
          size={15}
          style={{ color: isEmpty ? D.textDim : `${D.accent}b0` }}
          className="transition-transform group-hover:scale-110"
        />
      </div>
      <div
        className="mt-3 text-2xl font-black tracking-tight capitalize"
        style={{ color: isEmpty ? D.textDim : D.textPrimary }}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs" style={{ color: D.textDim }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeBadge({ label, state }: { label: string; state: string }) {
  const good = ["ready", "connected", "running", "production", "live"].includes(state);
  const sleeping = ["disconnected", "not_connected", "missing"].includes(state);
  const bad = ["failed"].includes(state);
  const color = good ? D.accentGreen : bad ? D.accentRed : sleeping ? D.accentAmber : D.accentAmber;

  // Friendlier labels for sleeping/disconnected states
  const friendlyLabel = sleeping ? `${label} sleeping` : `${label}: ${stateLabel(state)}`;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize"
      style={{ borderColor: `${color}40`, background: `${color}15`, color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: color,
          animation: sleeping ? "pulse 2s ease-in-out infinite" : undefined,
        }}
      />
      {friendlyLabel}
    </span>
  );
}

function MissionCard({
  mission,
}: {
  mission: MissionControlResponse["missions"][number];
}) {
  const color = MISSION_STATE_COLOR[mission.state] || D.textMuted;
  return (
    <Link
      href={`/studio?mission=${encodeURIComponent(mission.id)}`}
      className="group block rounded-2xl border p-4 transition hover:-translate-y-0.5"
      style={{
        background: D.surface,
        borderColor: D.border,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-black uppercase tracking-[.16em] capitalize"
              style={{ color }}
            >
              {stateLabel(mission.state)}
            </span>
            <span className="text-[10px]" style={{ color: D.textDim }}>
              {mission.agent === "spark" ? "Spark" : "LiTT"}
            </span>
          </div>
          <h3
            className="mt-2 truncate text-sm font-black"
            style={{ color: D.textPrimary }}
          >
            {mission.title}
          </h3>
          <p
            className="mt-1 line-clamp-2 text-xs leading-5"
            style={{ color: D.textMuted }}
          >
            {mission.blockedReason ||
              mission.currentStep ||
              "Mission ready to continue."}
          </p>
        </div>
        <Icon
          name="arrow"
          size={15}
          className="mt-1 shrink-0 transition group-hover:translate-x-0.5"
          style={{ color: D.textDim }}
        />
      </div>

      <div className="mt-4">
        <div
          className="mb-1.5 flex items-center justify-between text-[10px]"
          style={{ color: D.textDim }}
        >
          <span>Progress</span>
          <span>{Math.max(0, Math.min(100, mission.progress))}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, mission.progress))}%`,
              background: `linear-gradient(to right, ${D.accent}, ${D.accentGreen})`,
            }}
          />
        </div>
      </div>
    </Link>
  );
}

function HealthGrid({
  services,
}: {
  services: MissionControlResponse["health"];
}) {
  const categories = [
    ["platform", "Platform"],
    ["workspace", "Workspace"],
    ["provider", "Providers"],
  ] as const;

  return (
    <div className="space-y-4">
      {categories.map(([category, title]) => {
        const rows = services.filter((s) => s.category === category);
        if (!rows.length) return null;

        return (
          <section key={category}>
            <div
              className="mb-2 text-[10px] font-black uppercase tracking-[.18em]"
              style={{ color: D.textDim }}
            >
              {title}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {rows.map((service) => {
                const color = STATE_COLOR[service.state] || D.textDim;
                return (
                  <div
                    key={service.id}
                    className="rounded-xl border p-3"
                    style={{
                      background: "rgba(0,0,0,0.2)",
                      borderColor: D.border,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className="text-xs font-bold"
                          style={{ color: D.textPrimary }}
                        >
                          {service.label}
                        </div>
                        <div
                          className="mt-1 truncate text-[11px]"
                          style={{ color: D.textMuted }}
                        >
                          {service.detail}
                        </div>
                      </div>
                      <span
                        className="shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[.12em] capitalize"
                        style={{
                          borderColor: `${color}40`,
                          background: `${color}15`,
                          color,
                        }}
                      >
                        {stateLabel(service.state)}
                      </span>
                    </div>
                    <div
                      className="mt-2 flex items-center justify-between text-[10px]"
                      style={{ color: D.textDim }}
                    >
                      <span>
                        {service.latencyMs ? `${service.latencyMs} ms` : "Live status"}
                      </span>
                      {service.actionHref ? (
                        <Link
                          href={service.actionHref}
                          className="font-bold transition hover:opacity-80"
                          style={{ color: D.accent }}
                        >
                          Manage
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MissionControlDashboard() {
  const [data, setData] = useState<MissionControlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useUser();
  const displayName = user?.firstName || user?.username || "there";

  // Widget system
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [widgetData, setWidgetData] = useState<{
    recentCreations?: RecentCreation[];
    gallery?: GalleryWidgetData;
    discoverFeed?: DiscoverFeedItem[];
  }>({});
  const ownerMode = data?.ownerMode ?? false;
  const userId = data?.ownerMode ? "owner" : "user"; // layout key — real userId not needed for localStorage
  const {
    placements,
    updatePlacement,
    toggleCollapsed,
    toggleHidden,
    addWidget,
    removeWidget,
    resetLayout,
    moveWidget,
  } = useDashboardLayout(userId, ownerMode);

  // Fetch widget data (recent creations, gallery, discover feed)
  const loadWidgetData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/widgets?widgets=recent-creations,my-gallery,trending-gallery,discover-feed", {
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        setWidgetData(await res.json());
      }
    } catch {
      // Non-fatal — widgets show empty states
    }
  }, []);

  useEffect(() => {
    void loadWidgetData();
  }, [loadWidgetData]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      const response = await fetch("/api/dashboard/mission-control", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401) {
          setError("Your sign-in session needs to be refreshed.");
        } else {
          setError("Mission Control is temporarily unavailable.");
        }
        return;
      }
      setData(await response.json());
    } catch {
      setError("Mission Control is temporarily unavailable.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeMissions = useMemo(
    () =>
      (data?.missions ?? []).filter(
        (m) => !["completed", "failed", "cancelled"].includes(m.state),
      ),
    [data],
  );

  const urgentCount = useMemo(
    () =>
      (data?.health ?? []).filter((s) =>
        ["failed", "degraded", "disconnected", "reconnect_required"].includes(s.state),
      ).length +
      (data?.missions ?? []).filter(
        (m) => m.state === "failed" || m.state === "awaiting_approval",
      ).length,
    [data],
  );

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: D.bg }}
      >
        <div className="flex items-center gap-3 text-sm" style={{ color: D.textMuted }}>
          <div
            className="h-5 w-5 animate-spin rounded-full border-2"
            style={{ borderColor: `${D.accent}30`, borderTopColor: D.accent }}
          />
          Loading Mission Control…
        </div>
      </div>
    );
  }

  return (
    <main
      className="min-h-screen"
      style={{ background: D.bgGradient, color: D.textPrimary }}
    >
      <div className="mx-auto w-full max-w-[1680px] px-4 py-5 lg:px-6 xl:px-8">
        {/* === Header === */}
        <header
          className="mb-5 flex flex-col gap-4 rounded-3xl border p-5 lg:flex-row lg:items-center lg:justify-between"
          style={{
            background: "linear-gradient(135deg, rgba(0,0,0,0.4), rgba(124,58,237,0.05))",
            borderColor: `${D.accent}30`,
            backdropFilter: "blur(20px)",
            boxShadow: D.glow,
          }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[.18em]"
                style={{
                  borderColor: `${D.accentGreen}33`,
                  background: `${D.accentGreen}15`,
                  color: D.accentGreen,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: D.accentGreen }}
                />
                LiTT Mission Control
              </span>
              {data?.ownerMode ? (
                <span
                  className="rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[.16em]"
                  style={{
                    borderColor: `${D.accentAmber}33`,
                    background: `${D.accentAmber}15`,
                    color: D.accentAmber,
                  }}
                >
                  Owner
                </span>
              ) : null}
            </div>
            <h1
              className="mt-3 text-2xl font-black tracking-[-.04em] sm:text-3xl"
              style={{ color: D.textPrimary }}
            >
              Welcome back, {displayName}.
            </h1>
            <p className="mt-1 max-w-3xl text-sm" style={{ color: D.textMuted }}>
              LiTT has your workspace online and is ready for your next mission.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold transition hover:opacity-80 disabled:opacity-50"
              style={{
                borderColor: D.border,
                background: D.surface,
                color: D.textMuted,
              }}
            >
              <Icon
                name="refresh"
                size={14}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setCustomizeOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold transition hover:opacity-80"
              style={{
                borderColor: `${D.accent}40`,
                background: `${D.accent}10`,
                color: D.accent,
              }}
            >
              <Icon name="settings" size={14} />
              Customize
            </button>
            <Link
              href="/studio?tool=chat"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition hover:opacity-90"
              style={{ background: D.accent, color: "#fff" }}
            >
              <Icon name="play" size={14} />
              Continue Mission
            </Link>
            {data?.ownerMode ? (
              <Link
                href="/owner"
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-black transition hover:opacity-80"
                style={{
                  borderColor: `${D.accentAmber}40`,
                  background: `${D.accentAmber}15`,
                  color: D.accentAmber,
                }}
              >
                <Icon name="shield" size={14} />
                God Control
              </Link>
            ) : null}
          </div>
        </header>

        {/* === Error banner === */}
        {error ? (
          <div
            className="mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm"
            style={{
              borderColor: `${D.accentRed}33`,
              background: `${D.accentRed}10`,
              color: "#fca5a5",
            }}
          >
            <Icon name="alert" size={17} />
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-auto rounded-lg px-2 py-1 text-[10px] font-bold transition hover:opacity-80"
              style={{ background: `${D.accentRed}20` }}
            >
              Retry
            </button>
          </div>
        ) : null}

        {/* === Metric strip === */}
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Active Missions"
            value={activeMissions.length}
            detail="Currently running or waiting"
            icon="zap"
            highlight={activeMissions.length > 0}
            statusColor={activeMissions.length > 0 ? D.accentGreen : D.textDim}
          />
          <MetricCard
            label="Needs Attention"
            value={urgentCount}
            detail="Approvals, failures, or degraded services"
            icon="alert"
            highlight={urgentCount > 0}
            statusColor={urgentCount > 0 ? D.accentRed : D.accentGreen}
          />
          <MetricCard
            label="LiTTBits"
            value={(data?.billing.balance ?? 0).toLocaleString()}
            detail={data?.billing.plan ?? "Free"}
            icon="wallet"
            highlight={(data?.billing.balance ?? 0) > 0}
            statusColor={(data?.billing.balance ?? 0) > 0 ? D.accent : D.textDim}
          />
          <MetricCard
            label="Workspace"
            value={data?.project?.workspaceState ?? "No project"}
            detail={data?.project?.repository ?? "Connect a project"}
            icon="layers"
            statusColor={data?.project?.workspaceState === "ready" ? D.accentGreen : data?.project ? D.accentAmber : D.textDim}
          />
          <MetricCard
            label="Terminal"
            value={data?.project?.terminalState ?? "Unavailable"}
            detail="Project execution runtime"
            icon="terminal"
            statusColor={data?.project?.terminalState === "connected" ? D.accentGreen : data?.project?.terminalState === "disconnected" ? D.accentAmber : D.textDim}
          />
          <MetricCard
            label="Deployment"
            value={data?.project?.deploymentState ?? "None"}
            detail="Latest project environment"
            icon="rocket"
            statusColor={data?.project?.deploymentState === "production" ? D.accentGreen : data?.project?.deploymentState ? D.accentAmber : D.textDim}
          />
        </section>

        {/* === Two-column layout === */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.8fr)]">
          {/* Left operational column */}
          <div className="space-y-5">
            {/* Active Project Runtime */}
            <section
              className="rounded-3xl border p-5 transition-all duration-300 hover:border-[rgba(168,85,247,0.25)]"
              style={{
                background: "linear-gradient(135deg, rgba(0,0,0,0.35), rgba(124,58,237,0.03))",
                borderColor: D.border,
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div
                    className="text-[10px] font-black uppercase tracking-[.2em]"
                    style={{ color: D.accent }}
                  >
                    Active Project Runtime
                  </div>
                  <h2
                    className="mt-2 truncate text-xl font-black"
                    style={{ color: D.textPrimary }}
                  >
                    {data?.project?.repository ?? "No project connected"}
                  </h2>
                  <div
                    className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                    style={{ color: D.textMuted }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="branch" size={12} />
                      {data?.project?.branch ?? "No branch"}
                    </span>
                    {data?.project?.latestCommit ? (
                      <span>
                        Commit {data.project.latestCommit.slice(0, 8)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {data?.project ? (
                    <>
                      <RuntimeBadge
                        label="Workspace"
                        state={data.project.workspaceState}
                      />
                      <RuntimeBadge
                        label="Terminal"
                        state={data.project.terminalState}
                      />
                      <RuntimeBadge
                        label="Preview"
                        state={data.project.previewState}
                      />
                    </>
                  ) : null}
                </div>
              </div>

              {/* 5 primary actions */}
              <div className="mt-5 grid gap-3 md:grid-cols-5">
                <Link
                  href="/studio?tool=chat"
                  className="rounded-2xl border p-4 transition hover:opacity-90"
                  style={{
                    borderColor: `${D.accent}33`,
                    background: `${D.accent}10`,
                  }}
                >
                  <Icon name="message" size={18} style={{ color: D.accent }} />
                  <div
                    className="mt-3 text-sm font-black"
                    style={{ color: D.textPrimary }}
                  >
                    Ask LiTT
                  </div>
                  <div className="mt-1 text-xs" style={{ color: D.textMuted }}>
                    Continue the active project conversation.
                  </div>
                </Link>
                <Link
                  href="/studio?tool=code"
                  className="rounded-2xl border p-4 transition hover:opacity-90"
                  style={{
                    borderColor: `${D.accentCyan}22`,
                    background: `${D.accentCyan}0f`,
                  }}
                >
                  <Icon name="code" size={18} style={{ color: D.accentCyan }} />
                  <div
                    className="mt-3 text-sm font-black"
                    style={{ color: D.textPrimary }}
                  >
                    LiTT Code
                  </div>
                  <div className="mt-1 text-xs" style={{ color: D.textMuted }}>
                    Files, editor, terminal, checks, and preview.
                  </div>
                </Link>
                <Link
                  href="/studio?mission=Run%20a%20complete%20project%20health%20check"
                  className="rounded-2xl border p-4 transition hover:opacity-90"
                  style={{
                    borderColor: `${D.accentGreen}22`,
                    background: `${D.accentGreen}0e`,
                  }}
                >
                  <Icon name="heart" size={18} style={{ color: D.accentGreen }} />
                  <div
                    className="mt-3 text-sm font-black"
                    style={{ color: D.textPrimary }}
                  >
                    Health Scan
                  </div>
                  <div className="mt-1 text-xs" style={{ color: D.textMuted }}>
                    Run actual checks against the active workspace.
                  </div>
                </Link>
                <Link
                  href="/deployments"
                  className="rounded-2xl border p-4 transition hover:opacity-90"
                  style={{
                    borderColor: `${D.accentAmber}22`,
                    background: `${D.accentAmber}0e`,
                  }}
                >
                  <Icon name="rocket" size={18} style={{ color: D.accentAmber }} />
                  <div
                    className="mt-3 text-sm font-black"
                    style={{ color: D.textPrimary }}
                  >
                    Deploy
                  </div>
                  <div className="mt-1 text-xs" style={{ color: D.textMuted }}>
                    Preview, production, logs, and rollback.
                  </div>
                </Link>
                <Link
                  href="/games"
                  className="rounded-2xl border p-4 transition hover:opacity-90"
                  style={{
                    borderColor: `${D.accent}33`,
                    background: `${D.accent}10`,
                  }}
                >
                  <Icon name="gamepad" size={18} style={{ color: D.accent }} />
                  <div
                    className="mt-3 text-sm font-black"
                    style={{ color: D.textPrimary }}
                  >
                    Games
                  </div>
                  <div className="mt-1 text-xs" style={{ color: D.textMuted }}>
                    Game Cloud, Retro Arcade and browser games.
                  </div>
                </Link>
              </div>
            </section>

            {/* Mission Queue */}
            <section
              className="rounded-3xl border p-5"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: D.border,
                backdropFilter: "blur(16px)",
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div
                    className="text-[10px] font-black uppercase tracking-[.2em]"
                    style={{ color: D.accentGreen }}
                  >
                    Mission Queue
                  </div>
                  <h2
                    className="mt-1 text-lg font-black"
                    style={{ color: D.textPrimary }}
                  >
                    What LiTT is doing
                  </h2>
                </div>
                <Link
                  href="/projects"
                  className="text-xs font-bold transition hover:opacity-80"
                  style={{ color: D.accent }}
                >
                  View all missions
                </Link>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(data?.missions ?? []).slice(0, 6).map((mission) => (
                  <MissionCard key={mission.id} mission={mission} />
                ))}
                {!data?.missions?.length ? (
                  <div
                    className="md:col-span-2 rounded-2xl border border-dashed p-8 text-center"
                    style={{ borderColor: D.border }}
                  >
                    <Icon
                      name="bot"
                      size={24}
                      className="mx-auto"
                      style={{ color: `${D.accent}99` }}
                    />
                    <div
                      className="mt-3 text-sm font-black"
                      style={{ color: D.textPrimary }}
                    >
                      No mission yet
                    </div>
                    <div className="mt-1 text-xs" style={{ color: D.textMuted }}>
                      Give LiTT an outcome and let it create the plan.
                    </div>
                    <Link
                      href="/studio?tool=chat"
                      className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black"
                      style={{ background: D.accent, color: "#fff" }}
                    >
                      <Icon name="sparkles" size={14} />
                      Start Mission
                    </Link>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Live Activity */}
            <section
              className="rounded-3xl border p-5"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderColor: D.border,
                backdropFilter: "blur(16px)",
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div
                    className="text-[10px] font-black uppercase tracking-[.2em]"
                    style={{ color: D.accentCyan }}
                  >
                    Live Activity
                  </div>
                  <h2
                    className="mt-1 text-lg font-black"
                    style={{ color: D.textPrimary }}
                  >
                    Platform and project events
                  </h2>
                </div>
                <Link
                  href="/dashboard"
                  className="text-xs font-bold transition hover:opacity-80"
                  style={{ color: D.accent }}
                >
                  Open full log
                </Link>
              </div>

              <div className="mt-4 divide-y divide-white/5">
                {(data?.activity ?? []).slice(0, 8).map((event) => {
                  const color =
                    event.severity === "error"
                      ? D.accentRed
                      : event.severity === "warning"
                        ? D.accentAmber
                        : event.severity === "success"
                          ? D.accentGreen
                          : D.accentCyan;
                  return (
                    <div
                      key={event.id}
                      className="group flex items-start gap-3 py-3 transition-all first:pt-0 last:pb-0 hover:bg-white/[0.02] hover:px-2 hover:rounded-lg"
                    >
                      <span
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full transition-all group-hover:scale-125"
                        style={{
                          background: color,
                          boxShadow: `0 0 8px ${color}60`,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-sm font-bold"
                          style={{ color: D.textPrimary }}
                        >
                          {event.title}
                        </div>
                        {event.detail ? (
                          <div
                            className="mt-1 truncate text-xs"
                            style={{ color: D.textMuted }}
                          >
                            {event.detail}
                          </div>
                        ) : null}
                      </div>
                      <time
                        className="shrink-0 text-[10px]"
                        style={{ color: D.textDim }}
                      >
                        {formatTime(event.createdAt)}
                      </time>
                    </div>
                  );
                })}
                {!data?.activity?.length ? (
                  <div
                    className="py-8 text-center"
                  >
                    <div className="text-xs font-bold" style={{ color: D.textMuted }}>
                      No recent activity
                    </div>
                    <p className="mt-1 text-[11px]" style={{ color: D.textDim }}>
                      Activity from missions, builds, and deploys will appear here.
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {/* Right control rail */}
          <aside className="space-y-5">
            {/* System Status */}
            <section
              className="rounded-3xl border p-5 transition-all duration-300 hover:border-[rgba(168,85,247,0.25)]"
              style={{
                background: "linear-gradient(135deg, rgba(0,0,0,0.35), rgba(124,58,237,0.03))",
                borderColor: D.border,
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="flex items-center gap-2">
                <Icon name="cpu" size={17} style={{ color: D.accentGreen }} />
                <h2
                  className="text-sm font-black"
                  style={{ color: D.textPrimary }}
                >
                  System Status
                </h2>
              </div>
              <p className="mt-1 text-xs" style={{ color: D.textMuted }}>
                Platform, workspace, and provider health are separated.
              </p>
              <div className="mt-4">
                <HealthGrid services={data?.health ?? []} />
              </div>
            </section>

            {/* Owner Live Pulse — owner only */}
            {data?.ownerMode && data.growth ? (
              <section
                className="rounded-3xl border p-5"
                style={{
                  borderColor: `${D.accentAmber}26`,
                  background: `${D.accentAmber}0a`,
                  backdropFilter: "blur(16px)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Icon name="users" size={17} style={{ color: D.accentAmber }} />
                  <h2
                    className="text-sm font-black"
                    style={{ color: D.textPrimary }}
                  >
                    Owner Live Pulse
                  </h2>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MetricCard
                    label="Visitors Online"
                    value={data.growth.visitorsOnline}
                    icon="globe"
                  />
                  <MetricCard
                    label="Members Online"
                    value={data.growth.signedInOnline}
                    icon="users"
                  />
                  <MetricCard
                    label="Signups Today"
                    value={data.growth.signupsToday}
                    icon="users"
                  />
                  <MetricCard
                    label="Studio Opens"
                    value={data.growth.studioOpensToday}
                    icon="activity"
                  />
                  <MetricCard
                    label="First Prompts"
                    value={data.growth.firstPromptsToday}
                    icon="message"
                  />
                  <MetricCard
                    label="Upgrades"
                    value={data.growth.upgradesToday}
                    icon="dollar"
                  />
                </div>

                <Link
                  href="/owner"
                  className="mt-4 inline-flex items-center gap-2 text-xs font-black transition hover:opacity-80"
                  style={{ color: D.accentAmber }}
                >
                  Open full God Control
                  <Icon name="arrow" size={13} />
                </Link>
              </section>
            ) : null}

            {/* Operating Rules */}
            <section
              className="rounded-3xl border p-5 transition-all duration-300 hover:border-[rgba(168,85,247,0.25)]"
              style={{
                background: "linear-gradient(135deg, rgba(0,0,0,0.35), rgba(124,58,237,0.03))",
                borderColor: D.border,
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="flex items-center gap-2">
                <Icon name="shield" size={17} style={{ color: D.accent }} />
                <h2
                  className="text-sm font-black"
                  style={{ color: D.textPrimary }}
                >
                  Operating Rules
                </h2>
              </div>
              <div className="mt-4 space-y-3 text-xs" style={{ color: D.textMuted }}>
                <div className="flex gap-2">
                  <Icon
                    name="check"
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color: D.accentGreen }}
                  />
                  LiTT may inspect, search, test, and build without write approval.
                </div>
                <div className="flex gap-2">
                  <Icon
                    name="alert"
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color: D.accentAmber }}
                  />
                  Code edits, installs, Git writes, and production actions require
                  approval.
                </div>
                <div className="flex gap-2">
                  <Icon
                    name="shield"
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color: D.accent }}
                  />
                  Owner controls remain server-authorized and audited.
                </div>
              </div>
            </section>

            {/* Media Player — compact Now Playing card using the global Media Hub.
                No iframe is mounted here; the card reads from MediaHubProvider. */}
            <section>
              <MediaNowPlayingCard />
            </section>
          </aside>
        </div>

        {/* === Widget Grid — only show widgets with data === */}
        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[10px] font-black uppercase tracking-[.2em]" style={{ color: D.textDim }}>
              Widgets
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-[10px]" style={{ color: D.textDim }}>
                {placements.filter((p) => !p.hidden).length} active
              </span>
              <button
                type="button"
                onClick={() => setCustomizeOpen(true)}
                className="text-[10px] font-bold transition hover:opacity-80"
                style={{ color: D.accent }}
              >
                + Add widget
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {placements.filter((p) => !p.hidden).map((p) => {
              const def = getWidgetDefinition(p.widgetId);
              if (!def) return null;
              const widgetProps = {
                collapsed: p.collapsed,
                onToggleCollapse: () => toggleCollapsed(p.widgetId),
                onRemove: () => removeWidget(p.widgetId),
              };

              // Check if widget has data — hide empty ones unless they're interactive
              const hasData = (() => {
                switch (p.widgetId) {
                  case "litt-quick-ask": return true; // always show — interactive
                  case "mission-queue": return (data?.missions ?? []).length > 0;
                  case "current-project": return !!data?.project;
                  case "project-runtime": return !!data?.project;
                  case "pending-approvals": return (data?.missions ?? []).some(m => m.state === "awaiting_approval");
                  case "recent-activity": return (data?.activity ?? []).length > 0;
                  case "recent-creations": return (widgetData.recentCreations ?? []).length > 0;
                  case "my-gallery": return (widgetData.gallery?.myGallery ?? []).length > 0;
                  case "trending-gallery": return (widgetData.gallery?.trending ?? []).length > 0;
                  case "discover-feed": return (widgetData.discoverFeed ?? []).length > 0;
                  case "music-player": return true; // always show — interactive
                  case "littbits": return (data?.billing.balance ?? 0) > 0;
                  case "notifications": return false; // hide by default
                  case "deployments": return false; // hide by default
                  case "saved-items": return false; // hide by default
                  case "system-health": return true; // always show
                  case "audit-events": return false; // hide by default
                  // Owner metrics — only show if there's real data
                  case "visitors-online": return ownerMode && (data?.growth?.visitorsOnline ?? 0) > 0;
                  case "signed-in-online": return ownerMode && (data?.growth?.signedInOnline ?? 0) > 0;
                  case "signups-today": return ownerMode && (data?.growth?.signupsToday ?? 0) > 0;
                  case "studio-opens": return ownerMode && (data?.growth?.studioOpensToday ?? 0) > 0;
                  case "first-prompts": return ownerMode && (data?.growth?.firstPromptsToday ?? 0) > 0;
                  case "upgrades": return ownerMode && (data?.growth?.upgradesToday ?? 0) > 0;
                  case "revenue": return ownerMode && (data?.billing.revenueTodayCents ?? 0) > 0;
                  case "provider-costs": return ownerMode && (data?.billing.estimatedProviderCostTodayCents ?? 0) > 0;
                  case "failed-tools": return false;
                  case "failed-jobs": return false;
                  case "terminal-sessions": return false;
                  case "litt-live-sessions": return false;
                  case "marketplace-installs": return false;
                  default: return false;
                }
              })();

              if (!hasData) return null;

              const renderWidget = () => {
                switch (p.widgetId) {
                  case "litt-quick-ask": return <LiTTQuickAskWidget {...widgetProps} />;
                  case "mission-queue": return <MissionQueueWidget {...widgetProps} data={data} />;
                  case "current-project": return <CurrentProjectWidget {...widgetProps} data={data} />;
                  case "project-runtime": return <ProjectRuntimeWidget {...widgetProps} data={data} />;
                  case "pending-approvals": return <PendingApprovalsWidget {...widgetProps} data={data} />;
                  case "recent-activity": return <RecentActivityWidget {...widgetProps} data={data} />;
                  case "recent-creations": return <RecentCreationsWidget {...widgetProps} creations={widgetData.recentCreations ?? []} />;
                  case "my-gallery": return <MyGalleryWidget {...widgetProps} items={widgetData.gallery?.myGallery ?? []} />;
                  case "trending-gallery": return <TrendingGalleryWidget {...widgetProps} items={widgetData.gallery?.trending ?? []} />;
                  case "discover-feed": return <DiscoverFeedWidget {...widgetProps} posts={widgetData.discoverFeed ?? []} />;
                  case "music-player": return <MusicPlayerWidget {...widgetProps} />;
                  case "littbits": return <LiTTBitsWidget {...widgetProps} data={data} />;
                  case "notifications": return <NotificationsWidget {...widgetProps} />;
                  case "deployments": return <DeploymentsWidget {...widgetProps} />;
                  case "saved-items": return <SavedItemsWidget {...widgetProps} />;
                  case "visitors-online": return <OwnerMetricWidget {...widgetProps} title="Visitors Online" icon="eye" value={data?.growth?.visitorsOnline ?? 0} />;
                  case "signed-in-online": return <OwnerMetricWidget {...widgetProps} title="Signed-in Users" icon="users" value={data?.growth?.signedInOnline ?? 0} />;
                  case "signups-today": return <OwnerMetricWidget {...widgetProps} title="Signups Today" icon="user-plus" value={data?.growth?.signupsToday ?? 0} />;
                  case "studio-opens": return <OwnerMetricWidget {...widgetProps} title="Studio Opens" icon="sparkles" value={data?.growth?.studioOpensToday ?? 0} />;
                  case "first-prompts": return <OwnerMetricWidget {...widgetProps} title="First Prompts" icon="message" value={data?.growth?.firstPromptsToday ?? 0} />;
                  case "upgrades": return <OwnerMetricWidget {...widgetProps} title="Upgrades" icon="trending" value={data?.growth?.upgradesToday ?? 0} />;
                  case "revenue": return <OwnerMetricWidget {...widgetProps} title="Revenue" icon="dollar" value={`$${((data?.billing.revenueTodayCents ?? 0) / 100).toFixed(2)}`} detail="today" />;
                  case "provider-costs": return <OwnerMetricWidget {...widgetProps} title="Provider Costs" icon="cpu" value={`$${((data?.billing.estimatedProviderCostTodayCents ?? 0) / 100).toFixed(2)}`} detail="est. today" />;
                  case "failed-tools": return <OwnerMetricWidget {...widgetProps} title="Failed Tools" icon="alert" value="—" />;
                  case "failed-jobs": return <OwnerMetricWidget {...widgetProps} title="Failed Jobs" icon="alert" value="—" />;
                  case "terminal-sessions": return <OwnerMetricWidget {...widgetProps} title="Terminal Sessions" icon="terminal" value="—" />;
                  case "litt-live-sessions": return <OwnerMetricWidget {...widgetProps} title="LiTT Live Sessions" icon="bot" value="—" />;
                  case "marketplace-installs": return <OwnerMetricWidget {...widgetProps} title="Marketplace Installs" icon="shopping" value="—" />;
                  case "system-health": return <SystemHealthWidget {...widgetProps} data={data} />;
                  case "audit-events": return <AuditEventsWidget {...widgetProps} />;
                  default: return null;
                }
              };
              return (
                <div key={p.widgetId} className="min-h-[120px]">
                  {renderWidget()}
                </div>
              );
            })}
          </div>
          {/* Show a helpful empty state if no widgets have data */}
          {placements.filter((p) => !p.hidden).every((p) => {
            const def = getWidgetDefinition(p.widgetId);
            if (!def) return true;
            // Same logic as above — if all widgets are hidden, show the CTA
            const interactiveWidgets = ["litt-quick-ask", "music-player", "system-health"];
            return !interactiveWidgets.includes(p.widgetId);
          }) ? (
            <div
              className="rounded-2xl border p-8 text-center"
              style={{ background: D.surface, borderColor: D.border }}
            >
              <div className="text-sm font-bold" style={{ color: D.textMuted }}>
                No widget data yet
              </div>
              <p className="mt-2 text-xs" style={{ color: D.textDim }}>
                Connect a project, start a mission, or create something in the Studio to see live data here.
              </p>
              <Link
                href="/studio?tool=chat"
                className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition hover:opacity-90"
                style={{ background: D.accent, color: "#fff" }}
              >
                <Icon name="play" size={14} />
                Open Studio
              </Link>
            </div>
          ) : null}
        </section>
      </div>

      {/* Widget Library Drawer */}
      <WidgetLibraryDrawer
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        placements={placements}
        ownerMode={ownerMode}
        onAdd={addWidget}
        onRemove={removeWidget}
        onReset={resetLayout}
      />
    </main>
  );
}

export default MissionControlDashboard;
