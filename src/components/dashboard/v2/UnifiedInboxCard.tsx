"use client";

import { useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { EmptyState, SkeletonCard } from "./DashboardV2Primitives";
import { Icon, SEVERITY_COLORS, timeAgo } from "./dashboard-v2-utils";
import type { DashboardData, InboxItem } from "./dashboard-v2-types";

export function UnifiedInboxCard({
  data,
  loading,
  onMarkAllRead,
}: {
  data: DashboardData | null;
  loading: boolean;
  onMarkAllRead: () => void;
}) {
  const T = useTheme().resolvedColors;

  const items = useMemo<InboxItem[]>(() => {
    const errorEvents = (data?.events || [])
      .filter(
        (e) =>
          e.severity === "error" ||
          e.severity === "critical" ||
          e.severity === "warning",
      )
      .slice(0, 5);
    const accountErrors = (data?.accounts || []).filter(
      (a) =>
        a.last_error ||
        a.status === "expired" ||
        a.status === "missing_permission",
    );
    return [
      ...errorEvents.map((e) => ({
        id: e.id,
        severity: e.severity,
        message: e.title,
        time: e.created_at,
        area: e.provider,
      })),
      ...accountErrors.map((a) => ({
        id: a.id,
        severity: a.status === "expired" ? "warning" : "error",
        message: a.last_error || `${a.provider} needs attention`,
        time: a.last_synced_at,
        area: a.provider,
      })),
    ];
  }, [data]);

  if (loading) return <SkeletonCard />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Inbox zero"
        message="No errors, warnings, or pending approvals."
        color="#B6FF4A"
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const color = SEVERITY_COLORS[item.severity] || "#F97316";
        return (
          <div
            key={item.id}
            className="flex items-start gap-3 rounded-lg p-2.5"
            style={{ background: `${color}08`, borderLeft: `2px solid ${color}` }}
          >
            <div
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
              style={{ background: `${color}15`, color }}
            >
              <Icon name="alert" size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="text-xs font-semibold truncate"
                style={{ color: T.textColor }}
              >
                {item.message}
              </div>
              <div className="text-xs opacity-30 mt-0.5">
                {item.area} · {timeAgo(item.time)}
              </div>
            </div>
          </div>
        );
      })}
      {data && data.unreadCount > 0 && (
        <button
          onClick={onMarkAllRead}
          className="text-xs font-semibold opacity-50 hover:opacity-80 mt-2"
        >
          Mark all read
        </button>
      )}
    </div>
  );
}
