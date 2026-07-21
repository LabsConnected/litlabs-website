"use client";

/**
 * LiTT Base Station — MobileAgentHome
 *
 * The mobile breakpoint's first-class view. Renders a vertically-stacked
 * layout with: the crew at the top, the canvas (with the agents placed
 * naturally) in the middle, and the mission composer at the bottom. The
 * inspector opens full-screen as a sheet.
 *
 * Phase 4 keeps the same components as the desktop view; Phase 5 will
 * redesign the canvas as a 2.5D room for touch.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import StationSettings from "./StationSettings";
import AgentRoster from "./AgentRoster";
import SparkCustomizer from "./SparkCustomizer";
import StationViewport from "./StationViewport";
import AgentInspector from "./AgentInspector";
import MissionDock from "./MissionDock";
import {
  useStationStore,
  type AgentId,
} from "../store/stationStore";

interface MobileAgentHomeProps {
  saving: boolean;
}

export default function MobileAgentHome({ saving }: MobileAgentHomeProps) {
  const { resolvedColors: T } = useTheme();
  const layout = useStationStore();
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 lg:hidden">
      <StationSettings saving={saving} />
      <AgentRoster />
      <div className="h-72 shrink-0">
        <StationViewport
          mode={layout.mode}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
        />
      </div>
      <SparkCustomizer />
      <div className="min-h-0 flex-1">
        <MissionDock />
      </div>

      {/* Mobile inspector sheet */}
      {selectedAgent && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 lg:hidden"
          onClick={() => setSelectedAgent(null)}
        >
          <div
            className="w-full max-h-[80vh] overflow-y-auto rounded-2xl border"
            style={{
              borderColor: `${T.accentColor}45`,
              backgroundColor: T.boxBg,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setSelectedAgent(null)}
                aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-lg"
                style={{ backgroundColor: `${T.borderColor}22`, color: T.textMuted }}
              >
                <X size={13} />
              </button>
            </div>
            <div className="p-2 pt-0">
              <AgentInspector agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
