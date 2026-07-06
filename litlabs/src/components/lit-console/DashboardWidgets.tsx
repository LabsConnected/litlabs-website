"use client";

import { useTheme } from "@/context/ThemeContext";
import { LittMiniWidget } from "./widgets/LittMiniWidget";
import { ActiveAgentsWidget } from "./widgets/ActiveAgentsWidget";
import { ProjectsWidget } from "./widgets/ProjectsWidget";
import { TerminalLauncherWidget } from "./widgets/TerminalLauncherWidget";
import { GameArcadeWidget } from "./widgets/GameArcadeWidget";
import { DailyMissionsWidget } from "./widgets/DailyMissionsWidget";
import { RecentRunsWidget } from "./widgets/RecentRunsWidget";

export function DashboardWidgets() {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-lg font-black" style={{ color: T.headerColor }}>
            LiT Console
          </h1>
          <p className="text-xs" style={{ color: T.textMuted }}>
            Command center for agents, games, projects, and builds.
          </p>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="flex-1 overflow-y-auto p-4 pt-0">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {/* LiTT takes a tall spot on the left */}
          <div className="md:col-span-1 xl:row-span-2">
            <LittMiniWidget />
          </div>

          {/* Top row: active agents + game arcade */}
          <ActiveAgentsWidget />
          <GameArcadeWidget />
          <DailyMissionsWidget />

          {/* Second row: projects + terminal + recent runs */}
          <ProjectsWidget />
          <TerminalLauncherWidget />
          <RecentRunsWidget />
        </div>

        {/* Bottom hint */}
        <div className="mt-6 flex items-center justify-center">
          <p className="text-[10px]" style={{ color: T.textMuted }}>
            LiT Console v2 — model-agnostic, agent-powered, creator OS.
          </p>
        </div>
      </div>
    </div>
  );
}
