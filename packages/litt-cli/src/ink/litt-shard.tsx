/**
 * LittShard — LiTT identity face with canonical lifecycle state.
 *
 * The visual identity of LiTT — a subtle ASCII face that changes
 * expression based on the canonical runtime lifecycle state.
 *
 * States:
 *   IDLE       ◈  (calm, waiting)
 *   PLANNING   ◌  (focused, planning)
 *   VERIFYING  ◉  (checking, verifying)
 *   APPROVAL   !  (warning, needs attention)
 *   COMPLETE   ✓  (success, ready)
 *   FAILED     ×  (error, needs fix)
 *   CANCELLED  ◇  (cancelled, done)
 *   TIMEOUT    ⏱  (timeout, retry might help)
 *
 * Full shard is shown for:
 *   - greeting
 *   - planning
 *   - major transition
 *   - approval
 *   - verified completion
 *   - final failure
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { HoloState } from "./cockpit-store.js";

// ─── Lifecycle state glyphs (spec §22) ────────────────────────────────────

const SHARD_GLYPHS: Record<HoloState, string> = {
  IDLE: "◈",
  UNDERSTANDING: "◈",
  PLANNING: "◌",
  READING: "◌",
  EDITING: "◆",
  RUNNING: "◆",
  TESTING: "◆",
  VERIFYING: "◉",
  APPROVAL: "!",
  COMPLETE: "✓",
  FAILED: "×",
  CANCELLED: "◇",
  TIMEOUT: "⏱",
} as const;

// ─── Full shard ASCII art (shown selectively) ─────────────────────────────

const FULL_SHARD_LINES = [
  "    /\\",
  "   /  \\",
  "  < ◈ >",
  "   \\__/",
];

const FULL_SHARD_EXPRESSIONS: Partial<Record<HoloState, string[]>> = {
  IDLE: [
    "    /\\",
    "   /  \\",
    "  < ◈ >",
    "   \\__/",
  ],
  PLANNING: [
    "    ╭──────╮",
    "    │  ◌  ◌ │",
    "    │  ││   │",
    "    │  ││   │",
    "    ╰──┬┬───╯",
    "       ◇◇",
  ],
  VERIFYING: [
    "    ╭──────╮",
    "    │  ◉  ◉ │",
    "    │  ✦   │",
    "    ╰──┬┬───╯",
    "       ◇◇",
  ],
  APPROVAL: [
    "    ╭──────╮",
    "    │  ◉  ◉ │",
    "    │  ⚠   │",
    "    ╰──┬┬───╯",
    "       ◇◇",
  ],
  COMPLETE: [
    "    ╭──────╮",
    "    │  ^  ^ │",
    "    │  ╰╯   │",
    "    ╰─┬┬┬───╯",
    "      ✓✓",
  ],
  FAILED: [
    "    ╭──────╮",
    "    │  ×  × │",
    "    │       │",
    "    ╰─┬┬┬───╯",
    "      ✗✗",
  ],
};

// ─── LittShard Props ─────────────────────────────────────────────────────

export interface LittShardProps {
  /** Canonical lifecycle state from runtime */
  state: HoloState;
  /** Whether to show full ASCII art (true for greeting/planning/transition/approval/completion/failure) */
  full?: boolean;
  /** Elapsed time in seconds (for working states) */
  elapsed?: number;
}

// ─── LittShard Component ─────────────────────────────────────────────────

export function LittShard({ state, full = false, elapsed }: LittShardProps): React.ReactElement {
  const glyph = SHARD_GLYPHS[state] ?? "◈";
  const isWorking = state === "RUNNING" || state === "EDITING" || state === "TESTING" || state === "READING";
  const isComplete = state === "COMPLETE";
  const isFailed = state === "FAILED" || state === "CANCELLED" || state === "TIMEOUT";
  const isBlocked = state === "APPROVAL";

  const color = isComplete ? COLORS.success : isFailed ? COLORS.error : isBlocked ? COLORS.warning : isWorking ? COLORS.working : COLORS.brand;

  // Short variant: just the glyph + LiTT
  if (!full) {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text color={color} bold>
          {glyph} <Text color={COLORS.brand} bold>LiTT</Text>
        </Text>
        {elapsed !== undefined && isWorking && (
          <Text dimColor>{elapsed}s</Text>
        )}
      </Box>
    );
  }

  // Full shard for special moments
  const fullLines = FULL_SHARD_EXPRESSIONS[state] ?? FULL_SHARD_LINES;

  return (
    <Box flexDirection="column" alignItems="center">
      {fullLines.map((line, i) => (
        <Box key={i} justifyContent="center">
          <Text color={color}>{line}</Text>
        </Box>
      ))}
      <Text color={color} bold>
        {glyph} <Text color={COLORS.brand} bold>LiTT</Text>
      </Text>
      {isWorking && elapsed !== undefined && (
        <Text dimColor>{elapsed}s</Text>
      )}
    </Box>
  );
}

// ─── Idle face variation (breathing animation) ───────────────────────────

interface IdleFaceProps {
  frame: number;
}

export function IdleFace({ frame }: IdleFaceProps): React.ReactElement {
  const breathPatterns = [
    "    ╭──────╮  ",
    "    │  ◉  ◉ │  ",
    "    │  ◇◇   │  ",
    "    ╰──┬┬───╯  ",
    "       ··      ",
  ];
  const pattern = breathPatterns[frame % breathPatterns.length];

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={COLORS.brand}>{pattern}</Text>
    </Box>
  );
}

// ─── Mission step indicator ───────────────────────────────────────────────

export interface MissionStepIndicatorProps {
  currentStepId: string | null;
  steps: { id: string; status: string }[];
}

export function MissionStepIndicator({ currentStepId, steps }: MissionStepIndicatorProps): React.ReactElement {
  const currentStep = steps.find(s => s.id === currentStepId);
  const completedCount = steps.filter(s => s.status === "passed" || s.status === "complete").length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.secondary} dimColor>
        {completedCount}/{steps.length} steps
      </Text>
    </Box>
  );
}