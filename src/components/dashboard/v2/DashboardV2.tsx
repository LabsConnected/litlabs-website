"use client";

/**
 * DashboardV2 — LiTT's personal command center.
 *
 * Premium deep black-violet design matching the Studio shell.
 *
 * Sections:
 *   1. LiTT Daily Briefing — greeting, project context, recommended action
 *   2. Continue Working — current project card with deploy status
 *   3. Quick Actions — compact action tiles
 *   4. Recent Projects — responsive grid
 *   5. Recent Creations — mixed asset strip
 *   6. Activity + Project Health — two compact panels
 *   7. LiTT Media Player — YouTube dock (persistent across navigation)
 *
 * Only LiTT and Spark appear as official personalities.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import { MediaNowPlayingCard } from "@/components/media/MediaNowPlayingCard";
import { ContinueProjectCard } from "./ContinueProjectCard";
import { CurrentMissionCard } from "./CurrentMissionCard";
import { UnifiedInboxCard } from "./UnifiedInboxCard";
import { RecentWorkCard } from "./RecentWorkCard";
import { SystemHealthStrip } from "./SystemHealthStrip";
import { ActionButton } from "./DashboardV2Primitives";
import { Icon, getGreeting, timeAgo, STATUS_COLORS } from "./dashboard-v2-utils";
import type { DashboardData } from "./dashboard-v2-types";
import { D as DashTokens } from "@/lib/dashboard/tokens";

// ---------------------------------------------------------------------------
// Premium design tokens — deep black-violet matching Studio
// ---------------------------------------------------------------------------

const D = {
  ...DashTokens,
  bg: "#060410",
  bgGradient:
    "radial-gradient(circle at 15% 0%, rgba(124,58,237,0.12), transparent 40%), radial-gradient(circle at 85% 15%, rgba(168,85,247,0.06), transparent 30%), #060410",
  borderActive: "var(--dash-border-strong)",
};

// ---------------------------------------------------------------------------
// Quick action tiles
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = [
  { label: "Ask LiTT", href: "/studio?tool=chat", icon: "sparkles", color: D.accent },
  { label: "Open LiTT Code", href: "/code", icon: "code", color: "#65f4ff" },
  { label: "Create Image", href: "/studio?tool=image", icon: "image", color: "#ff00a0" },
  { label: "Make Music", href: "/studio?tool=music", icon: "music", color: "#f97316" },
  { label: "Start Mission", href: "/studio?tool=workflows", icon: "target", color: D.accentGreen },
  { label: "Import Project", href: "/studio/github", icon: "git", color: "#65f4ff" },
  { label: "View Assets", href: "/library", icon: "package", color: D.accent },
  { label: "Deployments", href: "/deployments", icon: "rocket", color: D.accentGreen },
] as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DashboardV2() {
  const { user } = useAppUser();
  const { profile } = useProfile();


  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setError(null);
    try {
      const [dashRes] = await Promise.allSettled([
        fetch("/api/dashboard"),
      ]);
      if (dashRes.status === "fulfilled" && dashRes.value.ok) {
        setData(await dashRes.value.json());
      } else if (dashRes.status === "fulfilled" && !dashRes.value.ok) {
        setError(
          dashRes.value.status === 401
            ? "Your sign-in session needs to be refreshed."
            : "Some connected workspace data is temporarily unavailable.",
        );
      }
      if (dashRes.status === "rejected") {
        setError("Some connected workspace data is temporarily unavailable.");
      }
    } catch {
      setError("Some connected workspace data is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/dashboard/events/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              unreadCount: 0,
              events: prev.events.map((e) => ({
                ...e,
                read_at: e.read_at || new Date().toISOString(),
              })),
            }
          : prev,
      );
    } catch {
      /* non-fatal */
    }
  };

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Member";

  const attentionCount = useMemo(() => {
    const errorEvents = (data?.events || []).filter(
      (e) =>
        e.severity === "error" ||
        e.severity === "critical" ||
        e.severity === "warning",
    ).length;
    const accountErrors = (data?.accounts || []).filter(
      (a) =>
        a.last_error ||
        a.status === "expired" ||
        a.status === "missing_permission",
    ).length;
    return errorEvents + accountErrors;
  }, [data]);

  // Build the LiTT briefing text from real project context
  const briefingText = useMemo(() => {
    if (loading) return "Loading your workspace...";
    if (error) return error;

    const projects = [
      ...(data?.projects || []),
      ...(data?.legacyProjects || []),
    ];
    const hasProject = projects.length > 0;
    const hasGithub = data?.accounts?.some(
      (a) => a.provider === "github" && a.status === "connected",
    );
    const hasVercel = data?.accounts?.some(
      (a) => a.provider === "vercel" && a.status === "connected",
    );

    const parts: string[] = [];
    parts.push(`${getGreeting()}, ${displayName}.`);

    if (hasProject) {
      const p = projects[0];
      const name =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p as any).repository_full_name || (p as any).name || "your project";
      const branch =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p as any).working_branch || (p as any).default_branch || "main";
      parts.push(`LiTTree LabStudios is connected to ${name} on ${branch}.`);
    } else {
      parts.push("No project is connected yet.");
    }

    const issues: string[] = [];
    if (hasGithub && !hasVercel) issues.push("deployment is not configured");
    if (attentionCount > 0)
      issues.push(`${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`);
    if (!hasGithub) issues.push("GitHub is not connected");

    if (issues.length > 0) {
      parts.push(`${issues.join(", ")}.`);
    } else if (hasProject) {
      parts.push("Everything looks ready to continue.");
    }

    return parts.join(" ");
  }, [loading, error, data, displayName, attentionCount]);

  const projects = [
    ...(data?.projects || []),
    ...(data?.legacyProjects || []),
  ];

  return (
    <div
      className="min-h-dvh"
      style={{ background: D.bgGradient, color: D.textPrimary }}
    >
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
        {/* === SECTION 1: LITT DAILY BRIEFING === */}
        <section
          className="mb-6 rounded-2xl border p-6 lg:p-7"
          style={{
            borderColor: D.borderActive,
            background:
              "linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(6,4,16,0.6) 60%)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3), 0 0 24px rgba(168,85,247,0.06)",
          }}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              {/* LiTT presence indicator */}
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-2 w-2">
                  <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full opacity-60" style={{ background: D.accentGreen }} />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: D.accentGreen }} />
                </span>
                <span
                  className="text-[10px] font-black uppercase tracking-[0.25em]"
                  style={{ color: D.accentGreen }}
                >
                  LiTT Online
                </span>
              </div>

              <h1 className="text-2xl font-black tracking-tight lg:text-3xl" style={{ color: D.textPrimary }}>
                {getGreeting()}, {displayName}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: D.textMuted }}>
                {briefingText}
              </p>

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton href="/studio?tool=chat" label="Continue Mission" primary icon="play" />
                <ActionButton href="/studio" label="Open Studio" icon="sparkles" />
                <ActionButton href="/settings/connections" label="View Project Health" icon="activity" />
              </div>
            </div>
          </div>
        </section>

        {/* Error banner */}
        {error && (
          <div
            className="mb-4 rounded-xl p-3 text-sm"
            style={{
              background: "rgba(239,68,68,0.08)",
              color: "#ef4444",
              border: "1px solid rgba(239,68,68,0.2)",
            }}
          >
            <Icon name="alert" size={14} className="inline mr-2" />
            {error}
          </div>
        )}

        {/* === SECTION 2: CONTINUE WORKING === */}
        <section className="mb-6">
          <div className="mb-3">
            <h2 className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: D.textDim }}>
              Continue Working
            </h2>
          </div>
          <ContinueProjectCard data={data} loading={loading} />
        </section>

        {/* === SECTION 3: QUICK ACTIONS === */}
        <section className="mb-6">
          <div className="mb-3">
            <h2 className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: D.textDim }}>
              Quick Actions
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="group flex flex-col items-center gap-2 rounded-xl border p-3 transition-all hover:scale-[1.03]"
                style={{
                  borderColor: D.border,
                  background: D.surface,
                }}
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg transition group-hover:scale-110"
                  style={{
                    background: `${action.color}15`,
                    border: `1px solid ${action.color}25`,
                  }}
                >
                  <Icon name={action.icon} size={16} style={{ color: action.color }} />
                </span>
                <span className="text-[11px] font-bold" style={{ color: D.textMuted }}>
                  {action.label}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* === MAIN GRID: Recent Projects + Activity === */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left column — Recent Projects + Recent Creations */}
          <div className="space-y-6 lg:col-span-8">
            {/* === SECTION 4: RECENT PROJECTS === */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: D.textDim }}>
                  Recent Projects
                </h2>
                {projects.length > 0 && (
                  <Link
                    href="/projects"
                    className="text-xs font-bold transition hover:opacity-80"
                    style={{ color: D.accent }}
                  >
                    View All →
                  </Link>
                )}
              </div>
              {loading ? (
                <div
                  className="rounded-2xl p-5 animate-pulse"
                  style={{ background: D.surface, border: `1px solid ${D.border}` }}
                >
                  <div className="h-4 w-32 rounded bg-white/5 mb-3" />
                  <div className="h-3 w-48 rounded bg-white/5 mb-2" />
                  <div className="h-3 w-24 rounded bg-white/5" />
                </div>
              ) : projects.length === 0 ? (
                <div
                  className="rounded-2xl border p-6 text-center"
                  style={{ background: D.surface, borderColor: D.border }}
                >
                  <div
                    className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full"
                    style={{ background: `${D.accent}10`, border: `1px solid ${D.accent}20` }}
                  >
                    <Icon name="folder" size={18} style={{ color: D.accent }} />
                  </div>
                  <p className="text-sm font-bold" style={{ color: D.textPrimary }}>
                    No projects yet
                  </p>
                  <p className="mt-1 text-xs" style={{ color: D.textMuted }}>
                    Connect GitHub or start a blank project to get started.
                  </p>
                  <div className="mt-3 flex justify-center gap-2">
                    <ActionButton href="/studio/github" label="Connect GitHub" primary icon="git" />
                    <ActionButton href="/projects/new" label="Start Blank" icon="plus" />
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {projects.slice(0, 4).map((p, i) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const any = p as any;
                    const name = any.repository_full_name || any.name || "Untitled";
                    const branch = any.working_branch || any.default_branch || "main";
                    const status = any.sync_status || any.connection_status || "pending";
                    const lastActivity = any.last_synced_at || any.connected_at || null;
                    const vercelUrl = any.vercel_production_url || null;
                    const statusColor = STATUS_COLORS[status] || "#6b7280";
                    return (
                      <Link
                        key={any.id || i}
                        href={`/projects/${any.id || ""}`}
                        className="group rounded-2xl border p-4 transition-all hover:scale-[1.01]"
                        style={{
                          borderColor: D.border,
                          background: D.surface,
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="truncate text-sm font-black" style={{ color: D.textPrimary }}>
                            {name}
                          </h3>
                          <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: statusColor }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
                            {status}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: D.textMuted }}>
                          <span className="flex items-center gap-1">
                            <Icon name="branch" size={10} />
                            {branch}
                          </span>
                          <span className="flex items-center gap-1">
                            <Icon name="clock" size={10} />
                            {timeAgo(lastActivity)}
                          </span>
                          {vercelUrl && (
                            <span className="flex items-center gap-1" style={{ color: D.accentGreen }}>
                              <Icon name="rocket" size={10} />
                              Live
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            {/* === SECTION 5: RECENT CREATIONS === */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: D.textDim }}>
                  Recent Creations
                </h2>
                <Link
                  href="/library"
                  className="text-xs font-bold transition hover:opacity-80"
                  style={{ color: D.accent }}
                >
                  View All →
                </Link>
              </div>
              <RecentWorkCard data={data} loading={loading} />
            </section>

            {/* === SECTION 6A: ACTIVITY === */}
            <section>
              <div className="mb-3">
                <h2 className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: D.textDim }}>
                  Recent Activity
                </h2>
              </div>
              <UnifiedInboxCard
                data={data}
                loading={loading}
                onMarkAllRead={handleMarkAllRead}
              />
            </section>
          </div>

          {/* Right column — Mission + Health + Media Player */}
          <div className="space-y-6 lg:col-span-4">
            {/* === SECTION 6B: PROJECT HEALTH === */}
            <section>
              <div className="mb-3">
                <h2 className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: D.textDim }}>
                  Project Health
                </h2>
              </div>
              <div
                className="rounded-2xl border p-4"
                style={{ background: D.surface, borderColor: D.border }}
              >
                <SystemHealthStrip loading={loading} />
              </div>
            </section>

            {/* === Current Mission === */}
            <section>
              <div className="mb-3">
                <h2 className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: D.textDim }}>
                  Current Mission
                </h2>
              </div>
              <CurrentMissionCard data={data} loading={loading} />
            </section>

            {/* === SECTION 7: LITT MEDIA (Now Playing card) === */}
            <section>
              <MediaNowPlayingCard />
            </section>
          </div>
        </div>

        {/* === Footer spacing === */}
        <div className="h-8" />
      </div>
    </div>
  );
}

export default DashboardV2;
