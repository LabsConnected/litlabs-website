"use client";

import { useMemo } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useAgentActivity } from "../hooks/useAgentActivity";
import { AGENTS } from "@/lib/agents";
import type { AgentId } from "../store/stationStore";

function statusColor(status: string): string {
  switch (status) {
    case "processing":
      return "#22d3ee";
    case "success":
      return "#34d399";
    case "failed":
      return "#fb7185";
    case "cancelled":
      return "#94a3b8";
    default:
      return "#fbbf24";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "processing":
      return "Running";
    case "success":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Queued";
  }
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface AgentActivityPanelProps {
  selectedAgentId?: AgentId | null;
  onOpenStudioAction?: (agentId: AgentId) => void;
}

export default function AgentActivityPanel({
  selectedAgentId,
  onOpenStudioAction,
}: AgentActivityPanelProps) {
  const { resolvedColors: T } = useTheme();
  const activity = useAgentActivity(20);

  const recentMissions = useMemo(() => {
    const filtered = selectedAgentId
      ? activity.recent.filter((m) => m.assigned_to === selectedAgentId)
      : activity.recent;
    return filtered.slice(0, 12);
  }, [activity.recent, selectedAgentId]);

  const agentIds: AgentId[] = ["litt", "spark"];

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3 rounded-2xl border p-3"
      style={{ borderColor: `${T.accentColor}25`, backgroundColor: `${T.boxBg}cc` }}
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>
            Recent Activity
          </h3>
          <p className="text-[9px]" style={{ color: T.textMuted }}>
            {activity.recent.length} missions · {activity.recent.filter((m) => m.status === "processing").length} running
          </p>
        </div>
        <button
          type="button"
          onClick={() => void activity.refresh()}
          aria-label="Refresh activity"
          className="grid h-7 w-7 place-items-center rounded-lg"
          style={{ backgroundColor: `${T.borderColor}22`, color: T.textMuted }}
        >
          <RefreshCw size={12} className={activity.loading ? "animate-spin" : ""} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {recentMissions.length === 0 ? (
          <p className="py-4 text-center text-[10px]" style={{ color: T.textMuted }}>
            No missions yet. Open Studio to assign a mission.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {recentMissions.map((m) => {
              const color = statusColor(m.status);
              return (
                <li
                  key={m.id}
                  className="rounded-lg border p-2 text-[10px]"
                  style={{ borderColor: `${T.borderColor}22`, backgroundColor: `${T.boxBg}aa` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-bold uppercase tracking-wider" style={{ color }}>
                      {statusLabel(m.status)}
                    </span>
                    <span className="ml-auto text-[9px]" style={{ color: T.textMuted }}>
                      {relativeTime(m.completed_at ?? m.updated_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2" style={{ color: T.textColor }}>
                    {m.task_input?.prompt ?? "(no prompt)"}
                  </p>
                  <p className="mt-0.5 text-[9px]" style={{ color: T.textMuted }}>
                    {AGENTS[m.assigned_to]?.name ?? m.assigned_to}
                    {m.source ? ` · ${m.source}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex flex-wrap gap-2 border-t pt-2" style={{ borderColor: `${T.borderColor}22` }}>
        {agentIds.map((id) => {
          const agent = AGENTS[id];
          if (!agent) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onOpenStudioAction?.(id)}
              className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[10px] font-bold transition-all"
              style={{
                borderColor: `${agent.color}50`,
                backgroundColor: `${agent.color}12`,
                color: agent.color,
              }}
            >
              <ExternalLink size={10} />
              Open {agent.name} in Studio
            </button>
          );
        })}
      </footer>
    </section>
  );
}
