"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { ActionButton, ConnectionPulse, EmptyState, SkeletonCard } from "./DashboardV2Primitives";
import { Icon, SEVERITY_COLORS, timeAgo } from "./dashboard-v2-utils";
import type { DashboardData, IntegrationProject, LegacyProject } from "./dashboard-v2-types";

export function RecentWorkCard({
  data,
  loading,
}: {
  data: DashboardData | null;
  loading: boolean;
}) {
  const T = useTheme().resolvedColors;
  const allProjects = [
    ...(data?.projects || []),
    ...(data?.legacyProjects || []),
  ];
  const creations = (data?.events || [])
    .filter(
      (e) =>
        e.event_type === "media_generated" ||
        e.event_type === "artifact_created" ||
        e.event_type === "image_generated",
    )
    .slice(0, 4);

  if (loading) return <SkeletonCard />;

  const hasAny = allProjects.length > 0 || creations.length > 0;

  if (!hasAny) {
    return (
      <EmptyState
        icon="package"
        title="No recent work"
        message="Projects and creations will appear here."
        action={<ActionButton href="/studio" label="Open Studio" icon="sparkles" />}
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {allProjects.slice(0, 3).map((proj) => {
        const name =
          (proj as IntegrationProject).repository_full_name ||
          (proj as LegacyProject).name ||
          "Untitled";
        const syncStatus =
          (proj as IntegrationProject).sync_status ||
          (proj as LegacyProject).connection_status ||
          "pending";
        return (
          <Link
            key={proj.id}
            href="/studio?tool=chat"
            className="block rounded-xl p-3 transition-all hover:opacity-80"
            style={{ background: `${T.boxBg}80`, border: `1px solid ${T.borderColor}20` }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold truncate" style={{ color: T.headerColor }}>
                {name}
              </span>
              <ConnectionPulse status={syncStatus} />
            </div>
            <div className="text-xs opacity-40">
              {timeAgo(
                (proj as IntegrationProject).last_synced_at ||
                  (proj as LegacyProject).last_synced_at ||
                  null,
              )}
            </div>
          </Link>
        );
      })}
      {creations.map((c) => {
        const color = SEVERITY_COLORS[c.severity] || "#ec4899";
        return (
          <Link
            key={c.id}
            href="/gallery"
            className="block rounded-xl p-3 transition-all hover:opacity-80"
            style={{ background: `${T.boxBg}80`, border: `1px solid ${color}20` }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: `${color}15` }}
              >
                <Icon name="image" size={14} style={{ color }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold truncate" style={{ color: T.headerColor }}>
                  {c.title}
                </div>
                <div className="text-xs opacity-30">{timeAgo(c.created_at)}</div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
