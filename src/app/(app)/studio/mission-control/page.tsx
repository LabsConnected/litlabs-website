"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LiveProjectStatus } from "@/components/dashboard/v3/LiveProjectStatus";
import { AgentActivity } from "@/components/dashboard/v3/AgentActivity";
import { RecentMedia } from "@/components/dashboard/v3/RecentMedia";
import { useMediaDock } from "@/components/dashboard/v3/useMediaDock";
import {
  useMissionControl,
  useDashboardMedia,
  deriveProject,
  derivePulseItems,
} from "@/components/dashboard/v3/useDashboardData";
import { useTheme } from "@/context/ThemeContext";

/**
 * /studio/mission-control — the runtime telemetry home.
 *
 * Live project status, agent activity, and recent media moved off the
 * dashboard launchpad and live here, inside Studio, where they help
 * perform the active task. Reached from Studio context (e.g. the
 * dashboard's Developer drawer) — never an ops console on Home.
 */
export default function MissionControlPage() {
  const missionControl = useMissionControl();
  const dashboardMedia = useDashboardMedia();
  const { actions: mediaActions } = useMediaDock();
  // Theme-token driven (was a hard-coded near-black page): follows
  // the applied theme — light under the default LiTT Signature theme.
  const { tokens } = useTheme();

  const currentProject = deriveProject(missionControl.data?.project ?? null);
  const pulseItems = derivePulseItems(missionControl.data ?? null);

  return (
    <div className="min-h-dvh" style={{ background: tokens.background }}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
        <div>
          <Link
            href="/studio"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium transition"
            style={{ color: tokens.textMuted }}
          >
            <ArrowLeft size={14} aria-hidden /> Back to Studio
          </Link>
          <h1
            className="mt-4 text-3xl font-bold tracking-tight"
            style={{ letterSpacing: "-0.02em", color: tokens.text }}
          >
            Mission control
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed" style={{ color: tokens.textMuted }}>
            Live status for your work — builds, agents, and media. Everything
            here is reported from the real runtime; nothing is faked.
          </p>
        </div>

        <LiveProjectStatus
          project={currentProject}
          pulseItems={pulseItems}
          loading={missionControl.loading}
        />
        <AgentActivity
          items={missionControl.data?.activity ?? []}
          loading={missionControl.loading}
        />
        <RecentMedia
          items={dashboardMedia.items}
          loading={dashboardMedia.loading}
          error={dashboardMedia.error}
          mediaActions={mediaActions}
        />
      </main>
    </div>
  );
}
