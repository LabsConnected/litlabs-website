"use client";

import { useTheme } from "@/context/ThemeContext";
import { ActionButton } from "./DashboardV2Primitives";
import type { DashboardData } from "./dashboard-v2-types";

export function LiTTDailyBrief({
  data,
  loading,
  attentionCount,
}: {
  data: DashboardData | null;
  loading: boolean;
  attentionCount: number;
}) {
  const T = useTheme().resolvedColors;

  if (loading) {
    return (
      <div
        className="rounded-2xl p-5 animate-pulse"
        style={{
          background: `${T.boxBg}90`,
          border: `1px solid ${T.borderColor}30`,
          minHeight: 120,
        }}
      />
    );
  }

  const projects = [
    ...(data?.projects || []),
    ...(data?.legacyProjects || []),
  ];
  const hasProject = projects.length > 0;
  const hasGithub = data?.accounts?.some(
    (a) => a.provider === "github" && a.status === "connected",
  );

  const facts: string[] = [];
  if (hasProject)
    facts.push(
      `${projects.length} project${projects.length === 1 ? "" : "s"} connected`,
    );
  if (hasGithub) facts.push("GitHub synced");
  if (attentionCount > 0)
    facts.push(
      `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`,
    );
  if (data?.events?.length)
    facts.push(
      `${data.events.length} recent event${data.events.length === 1 ? "" : "s"}`,
    );
  if (facts.length === 0) facts.push("No projects connected yet");

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: `linear-gradient(135deg, ${T.accentColor}10 0%, ${T.boxBg} 60%)`,
        border: `1px solid ${T.accentColor}25`,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div
            className="text-xs font-black uppercase tracking-[0.2em] mb-2"
            style={{ color: T.accentColor }}
          >
            LiTT Daily Brief
          </div>
          <div className="flex flex-wrap gap-2">
            {facts.map((fact, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: `${T.borderColor}20`, color: T.textColor }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: T.accentColor }}
                />
                {fact}
              </span>
            ))}
          </div>
        </div>
        <ActionButton href="/studio" label="Open Studio" primary icon="play" />
      </div>
    </div>
  );
}
