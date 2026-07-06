"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Activity, ArrowRight } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { EmptyState } from "@/components/site/EmptyState";

const RUNS = [
  {
    id: "r1",
    agent: "Director",
    task: "Project review",
    status: "done",
    time: "2m ago",
  },
  {
    id: "r2",
    agent: "Code Champ",
    task: "Lint pass",
    status: "done",
    time: "1h ago",
  },
  {
    id: "r3",
    agent: "Social Dom",
    task: "Draft post",
    status: "running",
    time: "5m ago",
  },
];

export function RecentRunsWidget() {
  const { resolvedColors: T } = useTheme();

  return (
    <BentoCard
      title="Recent Runs"
      icon={<Activity size={14} />}
      action={
        <Link
          href="/agents"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: T.accentColor }}
        >
          New Run
        </Link>
      }
    >
      {RUNS.length === 0 ? (
        <EmptyState
          icon="🚀"
          title="No runs yet"
          description="Start your first agent task."
          action={
            <Link
              href="/agents"
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              New Run
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {RUNS.map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between rounded-xl border p-2.5"
              style={{
                borderColor: `${T.borderColor}25`,
                backgroundColor: `${T.borderColor}08`,
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      run.status === "done" ? T.success : "#f59e0b",
                    boxShadow: `0 0 8px ${run.status === "done" ? T.success : "#f59e0b"}`,
                  }}
                />
                <div>
                  <div
                    className="text-xs font-bold"
                    style={{ color: T.textColor }}
                  >
                    {run.task}
                  </div>
                  <div className="text-[9px]" style={{ color: T.textMuted }}>
                    {run.agent} • {run.time}
                  </div>
                </div>
              </div>
              <button
                className="rounded-lg p-1.5"
                style={{ color: T.accentColor }}
              >
                <ArrowRight size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </BentoCard>
  );
}
