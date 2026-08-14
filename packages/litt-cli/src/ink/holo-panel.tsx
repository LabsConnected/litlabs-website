/**
 * LiTTHoloPanel — large reactive LiTT identity centerpiece.
 *
 * The holo reacts to HoloState:
 *   IDLE       — calm ◇ with slow pulse
 *   THINKING   — spinning ◈ with "Understanding request"
 *   PLANNING   — spinning ◈ with planning steps
 *   APPROVAL   — ⚠ with approval prompt
 *   RUNNING    — ▶ with execution steps + progress bar
 *   VERIFYING  — ✦ with verification steps
 *   SUCCESS    — ✓ READY TO SHIP
 *   FAILED     — ✗ failed
 *   CANCELLED  — ⊘ cancelled
 *   TIMEOUT    — ⏱ timeout
 *
 * The panel shows a bordered box with LiTT's symbol, state label,
 * and when active, a checklist of mission steps + progress bar.
 */

import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "./spinner.js";
import type { HoloState } from "./cockpit-store.js";

const HOLO_CONFIG: Record<HoloState, { icon: string; color: string; label: string; spinner: boolean }> = {
  IDLE: { icon: "◇", color: "magenta", label: "READY", spinner: false },
  THINKING: { icon: "◈", color: "cyan", label: "THINKING", spinner: true },
  APPROVAL: { icon: "⚠", color: "yellow", label: "APPROVAL REQUIRED", spinner: false },
  RUNNING: { icon: "▶", color: "cyan", label: "RUNNING", spinner: true },
  VERIFYING: { icon: "✦", color: "cyan", label: "VERIFYING", spinner: true },
  SUCCESS: { icon: "✓", color: "green", label: "READY TO SHIP", spinner: false },
  FAILED: { icon: "✗", color: "red", label: "FAILED", spinner: false },
  CANCELLED: { icon: "⊘", color: "yellow", label: "CANCELLED", spinner: false },
  TIMEOUT: { icon: "⏱", color: "yellow", label: "TIMEOUT", spinner: false },
};

const MISSION_STEPS = [
  "Understanding request",
  "Reading project",
  "Planning changes",
  "Editing",
  "Testing",
  "Verifying",
];

function ProgressBar({ progress, color }: { progress: number; color: string }): React.ReactElement {
  const total = 16;
  const filled = Math.round((progress / 100) * total);
  const empty = total - filled;
  return (
    <Box>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(empty)}</Text>
      <Text dimColor>  {progress}%</Text>
    </Box>
  );
}

export interface LiTTHoloPanelProps {
  state: HoloState;
  /** Active model name (what the runtime is actually using) */
  activeModel?: string | null;
  /** Routing reason (why this model was chosen) */
  routingReason?: string | null;
}

export function LiTTHoloPanel({ state, activeModel, routingReason }: LiTTHoloPanelProps): React.ReactElement {
  const config = HOLO_CONFIG[state] ?? HOLO_CONFIG.IDLE;

  // Determine which steps are done based on state
  const stepProgress: Record<string, number> = {
    IDLE: 0,
    THINKING: 1,
    RUNNING: 3,
    VERIFYING: 5,
    SUCCESS: 6,
    FAILED: 3,
    CANCELLED: 0,
    TIMEOUT: 0,
  };
  const currentStep = stepProgress[state] ?? 0;
  const progressPct = Math.round((currentStep / MISSION_STEPS.length) * 100);

  return (
    <Box
      borderStyle="round"
      borderColor={config.color}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      minWidth={28}
      width={28}
    >
      {/* LiTT symbol + spinner */}
      <Box justifyContent="center" marginBottom={0}>
        {config.spinner ? (
          <Text color={config.color} bold>
            <Spinner type="pulse" color={config.color} />  {config.icon} LiTT {config.icon}
          </Text>
        ) : (
          <Text color={config.color} bold>
            {config.icon} LiTT {config.icon}
          </Text>
        )}
      </Box>

      {/* State label */}
      <Box justifyContent="center">
        <Text color={config.color} bold>{config.label}</Text>
      </Box>

      {/* Orb visual — subtle geometric presence */}
      <Box justifyContent="center" marginTop={0}>
        {config.spinner ? (
          <Text color={config.color} dimColor>
            <Spinner type="dots" color={config.color} />
          </Text>
        ) : state === "IDLE" ? (
          <Text color={config.color} dimColor>·  ◇  ·</Text>
        ) : state === "SUCCESS" ? (
          <Text color="green" bold>✓  ◇  ✓</Text>
        ) : state === "FAILED" ? (
          <Text color="red" bold>✗  ◇  ✗</Text>
        ) : (
          <Text color={config.color} dimColor>·  {config.icon}  ·</Text>
        )}
      </Box>

      {/* Active model during execution */}
      {(state === "THINKING" || state === "RUNNING" || state === "VERIFYING") && activeModel && (
        <Box flexDirection="column" marginTop={1} justifyContent="center">
          <Text dimColor>Using: </Text>
          <Text color="blue" bold>{activeModel}</Text>
          {routingReason && <Text dimColor> {routingReason}</Text>}
        </Box>
      )}

      {/* Mission steps (only when active) */}
      {(state === "THINKING" || state === "RUNNING" || state === "VERIFYING" || state === "SUCCESS") && (
        <Box flexDirection="column" marginTop={1}>
          {MISSION_STEPS.map((step, idx) => {
            const done = idx < currentStep;
            const active = idx === currentStep && state !== "SUCCESS";
            const icon = done ? "✓" : active ? "●" : "○";
            const color = done ? "green" : active ? config.color : "gray";
            return (
              <Box key={step}>
                <Text color={color}>{icon} </Text>
                <Text color={color} dimColor={!done && !active}>{step}</Text>
              </Box>
            );
          })}
          {state !== "SUCCESS" && (
            <Box marginTop={1}>
              <ProgressBar progress={progressPct} color={config.color} />
            </Box>
          )}
        </Box>
      )}

      {/* Success state */}
      {state === "SUCCESS" && (
        <Box justifyContent="center" marginTop={1}>
          <Text color="green" bold>✓ READY TO SHIP</Text>
        </Box>
      )}

      {/* Idle hint */}
      {state === "IDLE" && (
        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>Waiting for instruction</Text>
        </Box>
      )}
    </Box>
  );
}
