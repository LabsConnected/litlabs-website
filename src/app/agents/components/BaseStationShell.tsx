"use client";

/**
 * LiTT Base Station — BaseStationShell (Phase 5: 2.5D + intro hero)
 *
 * Orchestrates the full Base Station. Phase 5 adds:
 *   - a polished hero header that names the station, surfaces the user
 *     greeting, and shows a tiny "all systems online" indicator
 *   - a 2.5D viewport experience driven by the upgraded StationViewport
 *   - a per-mode hint that explains what each mode is good for
 *
 * Desktop layout: 3-column grid (roster + customizer left, canvas center,
 * mission dock + inspector right). Mobile: stacked layout via
 * MobileAgentHome.
 */

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import StationSettings from "./StationSettings";
import AgentRoster from "./AgentRoster";
import SparkCustomizer from "./SparkCustomizer";
import StationViewport from "./StationViewport";
import AgentInspector from "./AgentInspector";
import MissionDock from "./MissionDock";
import MobileAgentHome from "./MobileAgentHome";
import { useStationStore, type AgentId } from "../store/stationStore";
import { useStationLayout } from "../hooks/useStationLayout";

const MODE_HINTS: Record<string, string> = {
  explore: "Pan with the pointer. Click an agent to inspect.",
  edit: "Drag agents to reposition. Saved automatically.",
  command: "Queue a mission below. It runs in the background.",
  saved: "Open a saved layout or preset.",
};

interface BaseStationShellProps {
  embedded?: boolean;
  selectedAgentId?: AgentId | null;
  onSelectAgentAction?: (agentId: AgentId) => void;
  onOpenAgentChatAction?: (agentId: AgentId) => void;
  onAssignMissionAction?: (agentId: AgentId) => void;
  onOpenTerminalAction?: (agentId: AgentId) => void;
}

export default function BaseStationShell({
  embedded = false,
  selectedAgentId,
  onSelectAgentAction,
  onOpenAgentChatAction,
  onAssignMissionAction,
  onOpenTerminalAction,
}: BaseStationShellProps) {
  const { resolvedColors: T } = useTheme();
  const { saving } = useStationLayout();
  const layout = useStationStore();
  const [internalSelectedAgent, setInternalSelectedAgent] = useState<AgentId | null>(null);
  const selectedAgent = selectedAgentId !== undefined ? selectedAgentId : internalSelectedAgent;
  const selectAgent = (agentId: AgentId | null) => {
    setInternalSelectedAgent(agentId);
    if (agentId) onSelectAgentAction?.(agentId);
  };

  return (
    <main
      className={embedded ? "relative h-full min-h-0 overflow-hidden" : "relative h-full min-h-0 overflow-y-auto"}
      style={{ backgroundColor: "transparent", color: T.textColor }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 15% 15%, ${T.accentColor}10, transparent 32%), radial-gradient(circle at 85% 40%, ${T.linkColor}0b, transparent 30%)`,
        }}
      />
      <div className={embedded ? "relative h-full min-h-0 p-2" : "relative mx-auto max-w-7xl space-y-3 px-3 py-3 sm:space-y-4 sm:px-4 sm:py-4"}>

        {!embedded && <header
          className="relative hidden items-center justify-between rounded-2xl border px-4 py-2 lg:flex"
          style={{
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(7,8,14,0.88)",
            backdropFilter: "blur(18px)",
          }}
        >
          <div>
            <h1 className="text-sm font-black" style={{ color: T.textColor }}>
              LiTT Base Station
            </h1>
            <p className="text-[9px]" style={{ color: T.textMuted }}>
              2 agents online · Systems operational
            </p>
          </div>
          <StationSettings saving={saving} />
          <div
            className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-200"
            style={{
              borderColor: "rgba(52,211,153,.4)",
              backgroundColor: "rgba(16,185,129,.15)",
            }}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            Online
          </div>
        </header>}

        <div className={embedded ? "flex h-full min-h-0 flex-col gap-3" : "hidden lg:flex lg:h-[calc(100dvh-6rem)] lg:flex-col lg:gap-3"}>
          <p
            className="text-center text-[10px] font-bold italic"
            style={{ color: T.textMuted }}
          >
            {MODE_HINTS[layout.mode] ?? ""}
          </p>
          <div className={embedded ? "grid min-h-0 flex-1 gap-3 md:grid-cols-[14rem_minmax(0,1fr)]" : "grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_minmax(600px,1fr)_340px]"}>
            <aside
              className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl border p-3"
              style={{
                borderColor: "rgba(255,255,255,0.10)",
                backgroundColor: "rgba(7,8,14,0.88)",
                backdropFilter: "blur(18px)",
              }}
            >
              <AgentRoster selectedAgentId={selectedAgent} onSelectAgentAction={selectAgent} />
              <SparkCustomizer />
            </aside>

            <section
              className="relative min-h-0 overflow-hidden rounded-2xl border"
              style={{
                borderColor: "rgba(255,255,255,0.10)",
                backgroundColor: "rgba(7,8,14,0.92)",
                backdropFilter: "blur(18px)",
              }}
            >
              <StationViewport mode={layout.mode} selectedAgent={selectedAgent} onSelectAgent={selectAgent} />
              {embedded && selectedAgent && (
                <div className="absolute bottom-3 right-3 top-3 z-20 w-[min(320px,42%)]">
                  <AgentInspector
                    agentId={selectedAgent}
                    onClose={() => selectAgent(null)}
                    onChatAction={onOpenAgentChatAction}
                    onAssignAction={onAssignMissionAction}
                    onTerminalAction={onOpenTerminalAction}
                  />
                </div>
              )}
            </section>

            {!embedded && <aside
              className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl border p-3"
              style={{
                borderColor: "rgba(255,255,255,0.10)",
                backgroundColor: "rgba(7,8,14,0.88)",
                backdropFilter: "blur(18px)",
              }}
            >
              {selectedAgent ? (
                <AgentInspector
                  agentId={selectedAgent}
                  onClose={() => selectAgent(null)}
                  onChatAction={onOpenAgentChatAction}
                  onAssignAction={onAssignMissionAction}
                  onTerminalAction={onOpenTerminalAction}
                />
              ) : (
                <section
                  className="rounded-2xl border p-4"
                  style={{
                    borderColor: "rgba(255,255,255,0.10)",
                    backgroundColor: "rgba(7,8,14,0.88)",
                  }}
                >
                  <h3 className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>
                    Inspector
                  </h3>
                  <p className="mt-2 text-xs" style={{ color: T.textMuted }}>
                    Click an agent on the canvas to inspect its role, personality, and domains.
                  </p>
                </section>
              )}
            </aside>}
          </div>

          {!embedded && <section
            className="rounded-2xl border p-3"
            style={{
              borderColor: "rgba(255,255,255,0.10)",
              backgroundColor: "rgba(7,8,14,0.88)",
              backdropFilter: "blur(18px)",
            }}
          >
            <MissionDock />
          </section>}
        </div>

        {!embedded && <MobileAgentHome saving={saving} selectedAgentId={selectedAgent} onSelectAgentAction={selectAgent} onOpenAgentChatAction={onOpenAgentChatAction} onAssignMissionAction={onAssignMissionAction} onOpenTerminalAction={onOpenTerminalAction} />}
      </div>
    </main>
  );
}
