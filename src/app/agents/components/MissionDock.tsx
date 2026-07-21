"use client";

/**
 * LiTT Base Station — MissionDock
 *
 * Mission composer + live activity feed. Wraps `useAgentMission` (write
 * side) and `useAgentActivity` (read side) so the dock is the canonical
 * surface for queueing and watching missions.
 *
 * The text input is a single-line composer with a "Send" button and a
 * quick toggle for the target agent (LiTT vs Spark). Phase 5 will expand
 * the composer with prompt templates and image attachments.
 */

import { useState, useCallback, useMemo } from "react";
import { Play, AlertCircle, Loader2, RefreshCw, Bot } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useAgentMission, type AgentSlug } from "../hooks/useAgentMission";
import { useAgentActivity } from "../hooks/useAgentActivity";
import { AGENTS } from "@/lib/agents";

const SUGGESTED_PROMPTS: ReadonlyArray<{ agent: AgentSlug; label: string }> = [
  { agent: "litt", label: "Audit my current code for risk" },
  { agent: "spark", label: "Sketch a brand moodboard for the studio" },
  { agent: "litt", label: "Plan a 4-step build for a new feature" },
  { agent: "spark", label: "Write 3 hero copy options" },
];

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

export default function MissionDock() {
  const { resolvedColors: T } = useTheme();
  const mission = useAgentMission();
  const activity = useAgentActivity(20);
  const [command, setCommand] = useState("");
  const [targetAgent, setTargetAgent] = useState<AgentSlug>("litt");

  const onSubmit = useCallback(async () => {
    const text = command.trim();
    if (text.length < 4 || mission.loading) return;
    await mission.submit({ agent: targetAgent, prompt: text, source: "base-station-dock" });
    setCommand("");
  }, [command, mission, targetAgent]);

  const hasText = command.trim().length >= 4;

  const recentMissions = useMemo(() => {
    return activity.recent.slice(0, 12);
  }, [activity.recent]);

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3 rounded-2xl border p-3"
      style={{ borderColor: `${T.accentColor}25`, backgroundColor: `${T.boxBg}cc` }}
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>
            Missions
          </h3>
          <p className="text-[9px]" style={{ color: T.textMuted }}>
            {mission.activeMissions.length} active · {mission.completedCount} completed
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

      {/* Composer */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {(["litt", "spark"] as AgentSlug[]).map((id) => {
            const active = targetAgent === id;
            const agent = AGENTS[id];
            if (!agent) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTargetAgent(id)}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-all"
                style={{
                  borderColor: active ? agent.color : `${T.borderColor}30`,
                  backgroundColor: active ? `${agent.color}22` : "transparent",
                  color: active ? agent.color : T.textMuted,
                }}
              >
                <Bot size={10} /> {agent.name}
              </button>
            );
          })}
        </div>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void onSubmit();
          }}
          rows={2}
          placeholder={`Ask ${AGENTS[targetAgent]?.name ?? "LiTT"} something…  (⌘/Ctrl-Enter to send)`}
          className="w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-xs outline-none"
          style={{ borderColor: `${T.borderColor}35`, color: T.textColor }}
        />
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {SUGGESTED_PROMPTS.filter((p) => p.agent === targetAgent).slice(0, 2).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setCommand(p.label)}
                className="rounded-full border px-2 py-0.5 text-[9px] font-bold"
                style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!hasText || mission.loading}
            className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black transition-all disabled:opacity-40"
            style={{
              backgroundColor: AGENTS[targetAgent]?.color ?? T.accentColor,
              color: "#fff",
            }}
          >
            {mission.loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Queue
          </button>
        </div>
        {mission.error && (
          <div
            className="flex items-center gap-2 rounded-lg border px-2 py-1 text-[10px]"
            style={{ borderColor: "#fb718440", backgroundColor: "#fb718415", color: "#fda4af" }}
          >
            <AlertCircle size={11} /> {mission.error}
          </div>
        )}
      </div>

      {/* Activity feed */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {recentMissions.length === 0 ? (
          <p className="py-4 text-center text-[10px]" style={{ color: T.textMuted }}>
            No missions yet. Queue one above to get started.
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
    </section>
  );
}
