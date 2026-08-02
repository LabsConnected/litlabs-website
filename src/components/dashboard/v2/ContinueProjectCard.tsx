"use client";

import { useTheme } from "@/context/ThemeContext";
import { ActionButton, ConnectionPulse, SkeletonCard } from "./DashboardV2Primitives";
import { Icon, timeAgo } from "./dashboard-v2-utils";
import type { DashboardData, IntegrationProject, LegacyProject } from "./dashboard-v2-types";

export function ContinueProjectCard({
  data,
  loading,
}: {
  data: DashboardData | null;
  loading: boolean;
}) {
  const T = useTheme().resolvedColors;
  const projects = [
    ...(data?.projects || []),
    ...(data?.legacyProjects || []),
  ];
  const hasProject = projects.length > 0;

  if (loading) return <SkeletonCard />;

  if (!hasProject) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: `${T.boxBg}90`, border: `1px solid ${T.borderColor}30` }}
      >
        <div className="text-sm font-bold mb-1" style={{ color: T.headerColor }}>
          No project yet
        </div>
        <p className="text-xs opacity-50 mb-4">
          Connect GitHub or start a blank project to get started.
        </p>
        <div className="flex gap-2">
          <ActionButton href="/studio/github" label="Connect GitHub" primary icon="git" />
          <ActionButton href="/projects/new" label="Start Blank" icon="plus" />
        </div>
      </div>
    );
  }

  const p = projects[0];
  const name =
    (p as IntegrationProject).repository_full_name ||
    (p as LegacyProject).name ||
    "Untitled";
  const branch =
    (p as IntegrationProject).working_branch ||
    (p as IntegrationProject).default_branch ||
    (p as LegacyProject).working_branch ||
    "main";
  const lastActivity =
    (p as IntegrationProject).last_synced_at ||
    (p as LegacyProject).last_synced_at ||
    null;
  const vercelUrl = (p as IntegrationProject).vercel_production_url || null;
  const syncStatus =
    (p as IntegrationProject).sync_status ||
    (p as LegacyProject).connection_status ||
    "pending";

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: `linear-gradient(135deg, ${T.accentColor}10 0%, ${T.boxBg} 60%)`,
        border: `1px solid ${T.accentColor}25`,
      }}
    >
      <div
        className="text-xs font-black uppercase tracking-[0.2em] mb-2"
        style={{ color: T.accentColor }}
      >
        Continue Building
      </div>
      <h3
        className="text-xl font-black mb-2 truncate"
        style={{ color: T.headerColor }}
      >
        {name}
      </h3>
      <div
        className="flex flex-wrap items-center gap-3 text-xs mb-4"
        style={{ color: T.textMuted }}
      >
        <span className="flex items-center gap-1">
          <Icon name="branch" size={12} />
          {branch}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="clock" size={12} />
          {timeAgo(lastActivity)}
        </span>
        <span className="flex items-center gap-1.5">
          <ConnectionPulse status={syncStatus} />
          {syncStatus}
        </span>
        {vercelUrl && (
          <span className="flex items-center gap-1" style={{ color: "#B6FF4A" }}>
            <Icon name="rocket" size={12} />
            Live
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <ActionButton href="/studio?tool=chat" label="Resume in Studio" primary icon="play" />
        <ActionButton href="/projects" label="View Project" icon="folder" />
      </div>
    </div>
  );
}
