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

  const currentProject = deriveProject(missionControl.data?.project ?? null);
  const pulseItems = derivePulseItems(missionControl.data ?? null);

  return (
    <div className="min-h-dvh" style={{ background: "#0a0a0a" }}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
        <div>
          <Link
            href="/studio"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium transition hover:text-white"
            style={{ color: "#a1a1aa" }}
          >
            <ArrowLeft size={14} aria-hidden /> Back to Studio
          </Link>
          <h1
            className="mt-4 text-3xl font-bold tracking-tight text-white"
            style={{ letterSpacing: "-0.02em" }}
          >
            Mission control
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
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
