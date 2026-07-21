"use client";

/**
 * LiTT Base Station — MobileAgentHome
 *
 * Mobile-first Base Station layout:
 * - Compact station controls
 * - Crew roster
 * - Responsive interactive viewport
 * - Spark customization
 * - Read-only agent activity panel
 * - Full-width agent inspector bottom sheet
 *
 * Phase 4 keeps the same components as the desktop view; Phase 5 will
 * redesign the canvas as a 2.5D room for touch. The activity panel
 * is read-only — all mission composition happens in Studio.
 */

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

import StationSettings from "./StationSettings";
import AgentRoster from "./AgentRoster";
import SparkCustomizer from "./SparkCustomizer";
import StationViewport from "./StationViewport";
import AgentInspector from "./AgentInspector";
import AgentActivityPanel from "./AgentActivityPanel";

import {
  useStationMode,
  type AgentId,
} from "../store/stationStore";

interface MobileAgentHomeProps {
  saving: boolean;
  selectedAgentId?: AgentId | null;
  onSelectAgentAction?: (agentId: AgentId | null) => void;
  onOpenAgentChatAction?: (agentId: AgentId) => void;
  onAssignMissionAction?: (agentId: AgentId) => void;
  onOpenTerminalAction?: (agentId: AgentId) => void;
}

export default function MobileAgentHome({
  saving,
  selectedAgentId: externalSelectedAgent,
  onSelectAgentAction: externalSelectAgent,
  onOpenAgentChatAction,
  onAssignMissionAction,
  onOpenTerminalAction,
}: MobileAgentHomeProps) {
  const { resolvedColors: T } = useTheme();

  // Selector hook: subscribes to the station store and returns only the
  // `mode` field. Re-renders are skipped when mode is unchanged, so this
  // component does not repaint on placements / skin / color changes.
  const mode = useStationMode();

  const [internalSelectedAgent, setInternalSelectedAgent] =
    useState<AgentId | null>(null);
  const selectedAgent = externalSelectedAgent !== undefined ? externalSelectedAgent : internalSelectedAgent;
  const setSelectedAgent = useCallback((agent: AgentId | null) => {
    setInternalSelectedAgent(agent);
    externalSelectAgent?.(agent);
  }, [externalSelectAgent]);

  const inspectorOpen = selectedAgent !== null;

  // Prevent background scroll while the inspector sheet is open.
  useEffect(() => {
    if (!inspectorOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [inspectorOpen]);

  // Escape closes the inspector.
  useEffect(() => {
    if (!inspectorOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedAgent(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [inspectorOpen, setSelectedAgent]);

  const closeInspector = () => {
    setSelectedAgent(null);
  };

  return (
    <main
      className="
        flex h-full min-h-0 flex-col
        overflow-hidden lg:hidden
      "
      style={{
        color: T.textColor,
      }}
    >
      <div
        className="
          flex min-h-0 flex-1 flex-col
          gap-3 overflow-y-auto px-3
          pb-[calc(env(safe-area-inset-bottom)+1rem)]
          pt-3
        "
      >
        <section className="shrink-0">
          <StationSettings saving={saving} />
        </section>

        <section className="shrink-0">
          <AgentRoster
            selectedAgentId={selectedAgent}
            onSelectAgentAction={setSelectedAgent}
          />
        </section>

        <section
          aria-label="Agent station viewport"
          className="
            relative min-h-[18rem] shrink-0
            overflow-hidden rounded-3xl border
            sm:min-h-[22rem]
          "
          style={{
            borderColor: `${T.accentColor}35`,
            backgroundColor: `${T.boxBg}CC`,
            boxShadow: `
              0 18px 50px rgba(0, 0, 0, 0.28),
              inset 0 1px 0 ${T.accentColor}18
            `,
          }}
        >
          <StationViewport
            mode={mode}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
          />

          <div
            className="
              pointer-events-none absolute inset-x-0 bottom-0
              h-20
            "
            style={{
              background: `linear-gradient(
                to top,
                ${T.boxBg},
                transparent
              )`,
            }}
          />
        </section>

        <section className="shrink-0">
          <SparkCustomizer />
        </section>

        <section
          aria-label="Agent activity"
          className="min-h-[14rem] shrink-0"
        >
          <AgentActivityPanel
            selectedAgentId={selectedAgent}
            onOpenStudioAction={(agentId) => {
              onAssignMissionAction?.(agentId);
            }}
          />
        </section>
      </div>

      {selectedAgent && (
        <div
          role="presentation"
          className="
            fixed inset-0 z-[100]
            flex items-end
            bg-black/70
            backdrop-blur-sm
            lg:hidden
          "
          onClick={closeInspector}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Agent inspector"
            className="
              flex max-h-[88dvh] w-full
              animate-in flex-col
              overflow-hidden
              rounded-t-[2rem] border-x border-t
              slide-in-from-bottom
              duration-200
            "
            style={{
              borderColor: `${T.accentColor}45`,
              backgroundColor: T.boxBg,
              boxShadow: "0 -24px 80px rgba(0, 0, 0, 0.55)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <header
              className="
                sticky top-0 z-10
                shrink-0 border-b
                px-4 pb-3 pt-2
              "
              style={{
                borderColor: `${T.borderColor}28`,
                backgroundColor: `${T.boxBg}F5`,
                backdropFilter: "blur(18px)",
              }}
            >
              <div className="flex justify-center pb-2">
                <div
                  className="h-1.5 w-12 rounded-full"
                  style={{
                    backgroundColor: `${T.textMuted}45`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p
                    className="
                      text-[10px] font-bold uppercase
                      tracking-[0.18em]
                    "
                    style={{
                      color: T.accentColor,
                    }}
                  >
                    Crew member
                  </p>

                  <h2 className="text-sm font-semibold">
                    Agent Inspector
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={closeInspector}
                  aria-label="Close agent inspector"
                  className="
                    grid h-10 w-10
                    place-items-center
                    rounded-xl border
                    transition
                    active:scale-95
                  "
                  style={{
                    borderColor: `${T.borderColor}35`,
                    backgroundColor: `${T.borderColor}18`,
                    color: T.textMuted,
                  }}
                >
                  <X className="pointer-events-none" size={18} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div
              className="
                min-h-0 flex-1 overflow-y-auto
                px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]
                pt-3
              "
            >
              <AgentInspector
                agentId={selectedAgent}
                onClose={closeInspector}
                onChatAction={onOpenAgentChatAction}
                onAssignAction={onAssignMissionAction}
                onTerminalAction={onOpenTerminalAction}
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
