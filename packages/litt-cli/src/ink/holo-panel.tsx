/**
 * LiTTHoloPanel — the LiTT identity centerpiece.
 *
 * LiTT has a recognizable face/head rendered in ASCII art.
 * The face changes expression based on the runtime state:
 *
 *   IDLE          — calm, eyes open, slow breathing pulse
 *   UNDERSTANDING — eyes focused, thinking dots
 *   PLANNING      — eyes narrowed, planning spinner
 *   READING       — eyes scanning, reading indicator
 *   EDITING       — eyes focused, editing indicator
 *   RUNNING       — eyes wide, execution animation
 *   TESTING       — eyes focused, testing indicator
 *   VERIFYING     — eyes checking, verification spinner
 *   APPROVAL      — eyes questioning, warning
 *   COMPLETE      — eyes happy, success glow
 *   FAILED        — eyes X, error state
 *   CANCELLED     — eyes closed, cancelled
 *   TIMEOUT       — eyes clock, timeout
 *
 * The panel also shows:
 *   - Active model during execution
 *   - Mission step checklist with progress bar
 *   - Elapsed time
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { Spinner } from "./spinner.js";
import { COLORS, stateColor } from "./colors.js";
import type { HoloState } from "./cockpit-store.js";

// ─── LiTT face expressions ──────────────────────────────────────────

/**
 * Each face is a 3-line ASCII art.
 * The face is the visual identity — it should be instantly recognizable.
 */
const FACES: Record<string, string[]> = {
  // Calm — eyes open, gentle smile
  IDLE: [
    "    ╭──────────╮    ",
    "    │  ◉    ◉  │    ",
    "    │    ╰╯    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Focused — eyes dot, thinking
  UNDERSTANDING: [
    "    ╭──────────╮    ",
    "    │  •    •  │    ",
    "    │    ╰╯    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Planning — eyes narrowed
  PLANNING: [
    "    ╭──────────╮    ",
    "    │  ‿    ‿  │    ",
    "    │    ╰╯    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Reading — eyes scanning
  READING: [
    "    ╭──────────╮    ",
    "    │  ←    →  │    ",
    "    │    ╰╯    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Editing — eyes focused
  EDITING: [
    "    ╭──────────╮    ",
    "    │  ◉    ◉  │    ",
    "    │   ▄▄▄    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Running — eyes wide, active
  RUNNING: [
    "    ╭──────────╮    ",
    "    │  ◉    ◉  │    ",
    "    │    ◆    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Testing — eyes checking
  TESTING: [
    "    ╭──────────╮    ",
    "    │  ◉    ◉  │    ",
    "    │   ✓✓    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Verifying — eyes checking carefully
  VERIFYING: [
    "    ╭──────────╮    ",
    "    │  ◉    ◉  │    ",
    "    │   ✦✦    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Approval — questioning
  APPROVAL: [
    "    ╭──────────╮    ",
    "    │  ◉    ◉  │    ",
    "    │    ⚠     │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Complete — happy
  COMPLETE: [
    "    ╭──────────╮    ",
    "    │  ^    ^  │    ",
    "    │    ╰╯    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Failed — X eyes
  FAILED: [
    "    ╭──────────╮    ",
    "    │  ✗    ✗  │    ",
    "    │    ╯╰    │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Cancelled — eyes closed
  CANCELLED: [
    "    ╭──────────╮    ",
    "    │  ─    ─  │    ",
    "    │    ─     │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
  // Timeout — clock eyes
  TIMEOUT: [
    "    ╭──────────╮    ",
    "    │  ⏱   ⏱  │    ",
    "    │    ─     │    ",
    "    ╰────┬┬────╯    ",
    "        ◇◇          ",
  ],
};

const STATE_LABELS: Record<string, string> = {
  IDLE: "READY",
  UNDERSTANDING: "UNDERSTANDING",
  PLANNING: "PLANNING",
  READING: "READING",
  EDITING: "EDITING",
  RUNNING: "RUNNING",
  TESTING: "TESTING",
  VERIFYING: "VERIFYING",
  APPROVAL: "APPROVAL",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  TIMEOUT: "TIMEOUT",
};

// Mission steps — the full lifecycle
const MISSION_STEPS = [
  { label: "Understand", states: ["UNDERSTANDING"] },
  { label: "Inspect", states: ["READING"] },
  { label: "Plan", states: ["PLANNING"] },
  { label: "Edit", states: ["EDITING"] },
  { label: "Execute", states: ["RUNNING"] },
  { label: "Test", states: ["TESTING"] },
  { label: "Verify", states: ["VERIFYING"] },
  { label: "Complete", states: ["COMPLETE"] },
];

/** Determine which steps are done/active based on holo state */
function getStepProgress(state: HoloState): { done: number; active: number } {
  const order = ["UNDERSTANDING", "READING", "PLANNING", "EDITING", "RUNNING", "TESTING", "VERIFYING", "COMPLETE"];
  const idx = order.indexOf(state);
  if (state === "IDLE") return { done: 0, active: -1 };
  if (state === "FAILED" || state === "CANCELLED" || state === "TIMEOUT") return { done: 6, active: -1 };
  if (state === "COMPLETE") return { done: 8, active: -1 };
  if (idx < 0) return { done: 0, active: -1 };
  return { done: idx, active: idx };
}

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

/** Breathing animation — subtle pulse for idle state */
function useBreathing(active: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame(f => (f + 1) % 4), 800);
    return () => clearInterval(timer);
  }, [active]);
  return frame;
}

export interface LiTTHoloPanelProps {
  state: HoloState;
  activeModel?: string | null;
  routingReason?: string | null;
  /** Mission start time for elapsed display */
  missionStartedAt?: number | null;
}

export function LiTTHoloPanel({ state, activeModel, routingReason, missionStartedAt }: LiTTHoloPanelProps): React.ReactElement {
  const color = stateColor(state);
  const face = FACES[state] ?? FACES.IDLE;
  const label = STATE_LABELS[state] ?? state;
  const isWorking = state === "UNDERSTANDING" || state === "PLANNING" || state === "READING"
    || state === "EDITING" || state === "RUNNING" || state === "TESTING" || state === "VERIFYING";
  const isIdle = state === "IDLE";
  const breathFrame = useBreathing(isIdle);

  // Elapsed time
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(missionStartedAt);
  useEffect(() => { startRef.current = missionStartedAt; }, [missionStartedAt]);
  useEffect(() => {
    if (!isWorking || !startRef.current) return;
    const timer = setInterval(() => {
      if (startRef.current) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isWorking]);

  const { done, active: activeStep } = getStepProgress(state);
  const progressPct = Math.round((done / MISSION_STEPS.length) * 100);
  const showSteps = isWorking || state === "COMPLETE";

  // Breathing dots for idle
  const breathDots = ["·  ◇  ·", "· ◇◇ ·", "·  ◇  ·", "·   ·  ·"];
  const idleLine = breathDots[breathFrame];

  return (
    <Box
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      minWidth={26}
      width={26}
    >
      {/* LiTT face — the visual identity */}
      <Box flexDirection="column" justifyContent="center" alignItems="center">
        {face.map((line, i) => (
          <Box key={i} justifyContent="center">
            <Text color={color} bold={state === "COMPLETE" || state === "FAILED"}>{line}</Text>
          </Box>
        ))}
      </Box>

      {/* Name + state */}
      <Box justifyContent="center" marginTop={0}>
        <Text color={COLORS.brand} bold>◇ LiTT ◇</Text>
      </Box>
      <Box justifyContent="center">
        <Text color={color} bold>{label}</Text>
      </Box>

      {/* Idle breathing animation */}
      {isIdle && (
        <Box justifyContent="center" marginTop={0}>
          <Text color={COLORS.brand} dimColor>{idleLine}</Text>
        </Box>
      )}

      {/* Working spinner */}
      {isWorking && (
        <Box justifyContent="center" marginTop={0}>
          <Text color={color}>
            <Spinner type="dots" color={color} />
          </Text>
        </Box>
      )}

      {/* Active model during execution */}
      {isWorking && activeModel && (
        <Box flexDirection="column" marginTop={1} justifyContent="center">
          <Text color={COLORS.info} bold>{activeModel}</Text>
        </Box>
      )}

      {/* Mission steps checklist */}
      {showSteps && (
        <Box flexDirection="column" marginTop={1}>
          {MISSION_STEPS.map((step, idx) => {
            const isDone = idx < done;
            const isActive = idx === activeStep;
            const icon = isDone ? "✓" : isActive ? "●" : "○";
            const stepColor = isDone ? COLORS.success : isActive ? color : COLORS.secondary;
            return (
              <Box key={step.label}>
                <Text color={stepColor}>{icon} </Text>
                <Text color={stepColor} dimColor={!isDone && !isActive}>{step.label}</Text>
              </Box>
            );
          })}
          {state !== "COMPLETE" && (
            <Box marginTop={1}>
              <ProgressBar progress={progressPct} color={color} />
            </Box>
          )}
          {isWorking && startRef.current && (
            <Box marginTop={0}>
              <Text dimColor>{elapsed}s</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Complete state */}
      {state === "COMPLETE" && (
        <Box justifyContent="center" marginTop={1}>
          <Text color={COLORS.success} bold>✓ READY TO SHIP</Text>
        </Box>
      )}

      {/* Idle hint */}
      {isIdle && (
        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>Waiting for instruction</Text>
        </Box>
      )}
    </Box>
  );
}
