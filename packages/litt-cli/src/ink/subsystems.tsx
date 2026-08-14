/**
 * Subsystems — panel selector for Runtime, Terminal, Memory, Agent,
 * Model, Gateway, Credentials.
 *
 * Shows which subsystem panel is currently selected. The selected
 * panel controls what detail view is shown below.
 */

import React from "react";
import { Box, Text } from "ink";
import type { CockpitPanel } from "./cockpit-store.js";

const PANELS: { id: CockpitPanel; label: string; icon: string }[] = [
  { id: "runtime", label: "Runtime", icon: "●" },
  { id: "terminal", label: "Terminal", icon: "▶" },
  { id: "memory", label: "Memory", icon: "◇" },
  { id: "agent", label: "Agent", icon: "◈" },
  { id: "model", label: "Model", icon: "◆" },
  { id: "gateway", label: "Gateway", icon: "⚠" },
  { id: "credentials", label: "Credentials", icon: "🔑" },
];

export interface SubsystemsProps {
  selected: CockpitPanel;
  onSelect: (panel: CockpitPanel) => void;
}

export function Subsystems({ selected, onSelect }: SubsystemsProps): React.ReactElement {
  return (
    <Box flexDirection="row" gap={1}>
      {PANELS.map((panel) => {
        const isSelected = panel.id === selected;
        return (
          <Box key={panel.id}>
            <Text
              color={isSelected ? "magenta" : "gray"}
              bold={isSelected}
              underline={isSelected}
            >
              {isSelected ? `[${panel.label}]` : ` ${panel.label} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
