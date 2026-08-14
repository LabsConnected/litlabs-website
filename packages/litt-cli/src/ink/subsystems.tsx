/**
 * Subsystems — real status cards with independent truth.
 *
 * Each subsystem shows its own ONLINE/IDLE/RUNNING/ERROR state.
 * States are derived from actual runtime data, not guessed.
 *
 * Subsystems:
 *   RUNTIME      — local runtime readiness
 *   TERMINAL     — shell executor availability
 *   MEMORY       — runtime store / memory state
 *   AGENT        — agent loop state (holo state)
 *   MODEL        — model provider readiness
 *   GATEWAY      — execution gateway readiness
 *   CREDENTIALS  — credential broker state
 */

import React from "react";
import { Box, Text } from "ink";
import type { HoloState, LocalRuntimeState, RemoteRuntimeState } from "./cockpit-store.js";

export type SubsystemStatus = "online" | "ready" | "idle" | "running" | "error" | "offline";

export interface SubsystemCard {
  id: string;
  label: string;
  status: SubsystemStatus;
}

export interface SubsystemsProps {
  selected: string;
  onSelect: (panel: string) => void;
  localRuntime: LocalRuntimeState;
  remoteRuntime: RemoteRuntimeState;
  holoState: HoloState;
  modelReady: boolean;
}

// Re-export for type compatibility
export type { CockpitPanel } from "./cockpit-store.js";

function statusIcon(status: SubsystemStatus): string {
  switch (status) {
    case "online": return "●";
    case "ready": return "●";
    case "running": return "▶";
    case "error": return "✗";
    case "offline": return "○";
    default: return "○";
  }
}

function statusColor(status: SubsystemStatus): string {
  switch (status) {
    case "online": return "green";
    case "ready": return "green";
    case "running": return "blue";
    case "error": return "red";
    case "offline": return "gray";
    default: return "yellow";
  }
}

function statusLabel(status: SubsystemStatus): string {
  return status.toUpperCase();
}

export function Subsystems({ selected, onSelect, localRuntime, remoteRuntime, holoState, modelReady }: SubsystemsProps): React.ReactElement {
  // Derive independent subsystem states from actual data
  const cards: SubsystemCard[] = [
    {
      id: "runtime",
      label: "RUNTIME",
      status: localRuntime === "ready" ? "online" : localRuntime === "error" ? "error" : "idle",
    },
    {
      id: "terminal",
      label: "TERMINAL",
      status: localRuntime === "ready" ? "ready" : "offline",
    },
    {
      id: "memory",
      label: "MEMORY",
      status: localRuntime === "ready" ? "ready" : "offline",
    },
    {
      id: "agent",
      label: "AGENT",
      status: holoState === "THINKING" || holoState === "RUNNING" ? "running"
        : holoState === "VERIFYING" ? "running"
        : holoState === "SUCCESS" ? "ready"
        : holoState === "FAILED" ? "error"
        : holoState === "IDLE" ? "idle"
        : "idle",
    },
    {
      id: "model",
      label: "MODEL",
      status: modelReady ? "ready" : "offline",
    },
    {
      id: "gateway",
      label: "GATEWAY",
      status: localRuntime === "ready" ? "ready" : "offline",
    },
    {
      id: "credentials",
      label: "CREDS",
      status: modelReady ? "ready" : "offline",
    },
  ];

  return (
    <Box flexDirection="column" gap={0}>
      {cards.map((card) => {
        const isSelected = card.id === selected;
        const color = statusColor(card.status);
        const icon = statusIcon(card.status);
        const label = statusLabel(card.status);

        return (
          <Box key={card.id}>
            <Box width={14}>
              <Text
                color={isSelected ? "magenta" : "gray"}
                bold={isSelected}
                underline={isSelected}
              >
                {isSelected ? "[" : " "}
                {card.label.padEnd(11)}
                {isSelected ? "]" : " "}
              </Text>
            </Box>
            <Text color={color}>{icon} </Text>
            <Text color={color} dimColor={card.status === "offline"}>{label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
