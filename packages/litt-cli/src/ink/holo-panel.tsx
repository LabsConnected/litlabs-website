/**
 * LiTTHoloPanel — LiTT identity, state-reactive.
 *
 * Renders the current Holo state. State transitions come from
 * canonical runtime events — the UI never guesses state.
 *
 * States:
 *   IDLE       — waiting for input
 *   THINKING   — model is generating
 *   APPROVAL   — gateway requires human approval
 *   RUNNING    — tool executing
 *   VERIFYING  — verification gate running (runtime-proved COMPLETE check)
 *   SUCCESS    — run completed successfully
 *   FAILED     — run failed
 *   CANCELLED  — run was cancelled
 *   TIMEOUT    — run timed out
 */

import React from "react";
import { Box, Text } from "ink";
import type { HoloState } from "./cockpit-store.js";

const HOLO_CONFIG: Record<HoloState, { icon: string; color: string; label: string }> = {
  IDLE: { icon: "◊", color: "gray", label: "idle" },
  THINKING: { icon: "◈", color: "cyan", label: "thinking" },
  APPROVAL: { icon: "⚠", color: "yellow", label: "approval required" },
  RUNNING: { icon: "▶", color: "blue", label: "running" },
  VERIFYING: { icon: "✦", color: "magenta", label: "verifying" },
  SUCCESS: { icon: "✓", color: "green", label: "success" },
  FAILED: { icon: "✗", color: "red", label: "failed" },
  CANCELLED: { icon: "⊘", color: "yellow", label: "cancelled" },
  TIMEOUT: { icon: "⏱", color: "yellow", label: "timeout" },
};

export function LiTTHoloPanel({ state }: { state: HoloState }): React.ReactElement {
  const config = HOLO_CONFIG[state] ?? HOLO_CONFIG.IDLE;

  return (
    <Box
      borderStyle="round"
      borderColor={config.color}
      paddingX={2}
      paddingY={0}
      flexDirection="column"
      minWidth={24}
    >
      <Box justifyContent="center">
        <Text color={config.color} bold>{config.icon} LiTT</Text>
      </Box>
      <Box justifyContent="center">
        <Text color={config.color}>{config.label}</Text>
      </Box>
    </Box>
  );
}
