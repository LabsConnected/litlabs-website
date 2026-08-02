"use client";

import { useTheme } from "@/context/ThemeContext";
import { ActionButton, EmptyState, SkeletonCard } from "./DashboardV2Primitives";
import { SEVERITY_COLORS, timeAgo } from "./dashboard-v2-utils";
import type { DashboardData } from "./dashboard-v2-types";

export function CurrentMissionCard({
  data,
  loading,
}: {
  data: DashboardData | null;
  loading: boolean;
}) {
  const T = useTheme().resolvedColors;
  const events = data?.events || [];
  const missions = events
    .filter(
      (e) =>
        e.event_type === "mission_created" || e.event_type === "mission_updated",
    )
    .slice(0, 3);

  if (loading) return <SkeletonCard />;

  if (missions.length === 0) {
    return (
      <EmptyState
        icon="target"
        title="No active mission."
        message="Start a Mission in Studio and it will appear here."
        action={<ActionButton href="/studio?tool=workflows" label="Open Mission Forge" icon="target" />}
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {missions.map((m) => {
        const color = SEVERITY_COLORS[m.severity] || "#3b82f6";
        return (
          <div
            key={m.id}
            className="rounded-xl p-3"
            style={{ background: `${color}08`, borderLeft: `3px solid ${color}` }}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className="text-sm font-bold truncate"
                style={{ color: T.headerColor }}
              >
                {m.title}
              </span>
              <span
                className="text-xs font-semibold uppercase"
                style={{ color }}
              >
                {m.severity}
              </span>
            </div>
            {m.description && (
              <p className="text-xs opacity-50 truncate">{m.description}</p>
            )}
            <div className="text-xs opacity-30 mt-1">{timeAgo(m.created_at)}</div>
          </div>
        );
      })}
    </div>
  );
}
