/**
 * StatusBar — the LiTT shell's two-line bottom bar.
 *
 *   LiTT Auto → GPT-5.6                    ○ Plan   ● Act
 *   litlabs-website · main · LOCAL              +292 -96
 *
 * Right-side states (one at a time):
 *   clean          — nothing changed
 *   +292 -96       — dirty (modified + untracked)
 *   ◉ Working · 12s — mission/chat in flight
 *   ! failed · n   — last mission failed (message + [v] hint)
 *
 * No fake statuses. Everything comes from canonical state.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import type { HoloState, MissionState } from "./cockpit-store.js";

/** Shorten model name: "anthropic/claude-sonnet-4.6" → "Sonnet 4.6" */
function shortModelName(model: string | null): string {
  if (!model) return "";
  const withoutProvider = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const cleaned = withoutProvider
    .replace(/^claude-/, "Claude ")
    .replace(/^gpt-/, "GPT-")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^o1-/, "o1 ")
    .replace(/^o3-/, "o3 ")
    .replace(/-/g, " ");
  return cleaned.replace(/\b\w/, (c) => c.toUpperCase());
}

/** Truncate a string to fit, preserving the tail (most meaningful part). */
function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return "…" + text.slice(text.length - (max - 1));
}

function isWorking(h: HoloState): boolean {
  return h === "UNDERSTANDING" || h === "PLANNING" || h === "READING"
    || h === "EDITING" || h === "RUNNING" || h === "TESTING"
    || h === "VERIFYING" || h === "APPROVAL";
}

export interface StatusBarProps {
  project: string;
  branch: string;
  localRuntime: string;
  holoState: HoloState;
  brain: string;
  activeModel: string | null;
  mode: "plan" | "act";
  isProcessing: boolean;
  busySince: number | null;
  missionState: MissionState | null;
  gitModified: number;
  gitUntracked: number;
}

export function StatusBar({
  project, branch, localRuntime, holoState, brain, activeModel,
  mode, isProcessing, busySince, missionState, gitModified, gitUntracked,
}: StatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  const working = isProcessing || isWorking(holoState);
  const busy = working || holoState === "COMPLETE" || holoState === "FAILED"
    || holoState === "CANCELLED" || holoState === "TIMEOUT";

  // Right-hand status: clean / +N -M / ◉ Working · Ns / ! failed
  let right: React.ReactElement;
  if (working) {
    // Real elapsed time: busySince (chat) or mission startedAt (mission).
    const started = busySince ?? missionState?.startedAt ?? Date.now();
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    right = (
      <Text color={COLORS.working} bold>
        ◉ Working · {seconds}s
      </Text>
    );
  } else if (missionState && (missionState.state === "FAILED" || missionState.state === "CANCELLED" || missionState.state === "TIMEOUT")) {
    const label = missionState.state === "FAILED" ? "failed" : missionState.state.toLowerCase();
    const tests = missionState.testResults && missionState.testResults.failed > 0
      ? ` · ${missionState.testResults.failed} test${missionState.testResults.failed !== 1 ? "s" : ""} failing`
      : "";
    right = (
      <Text color={COLORS.error} bold>
        ! {label}{tests}  <Text dimColor>[v] View</Text>
      </Text>
    );
  } else if (gitModified + gitUntracked > 0) {
    right = (
      <Text color={COLORS.warning}>
        +{gitModified + gitUntracked}
        <Text dimColor>  </Text>
      </Text>
    );
  } else {
    right = <Text color={COLORS.success} dimColor={!busy}>clean</Text>;
  }

  // ── Line 1: brain → active   |   Plan/Act ──
  const brainShort = truncateTail(brain, 26);
  const modelShort = activeModel ? truncateTail(shortModelName(activeModel), 22) : null;
  const planDot = mode === "plan" ? "●" : "○";
  const actDot = mode === "act" ? "●" : "○";

  const left1 = (
    <Text>
      <Text color={COLORS.brand} bold>{brainShort}</Text>
      {modelShort && (
        <>
          <Text dimColor> → </Text>
          <Text color={COLORS.info}>{modelShort}</Text>
        </>
      )}
    </Text>
  );

  const right1 = (
    <Text>
      <Text color={mode === "plan" ? COLORS.brand : COLORS.secondary} bold={mode === "plan"}>{planDot} Plan</Text>
      <Text dimColor>   </Text>
      <Text color={mode === "act" ? COLORS.brand : COLORS.secondary} bold={mode === "act"}>{actDot} Act</Text>
    </Text>
  );

  // ── Line 2: project · branch · LOCAL   |   right status ──
  const projectShort = truncateTail(project, 26);
  const branchShort = truncateTail(branch, 24);
  const localIcon = localRuntime === "ready" ? "●" : localRuntime === "error" ? "✗" : "○";
  const localColor = localRuntime === "ready" ? COLORS.success : localRuntime === "error" ? COLORS.error : COLORS.warning;
  const localLabel = localRuntime === "ready" ? "LOCAL" : localRuntime === "error" ? "LOCAL ERR" : "LOCAL…";

  const left2 = (
    <Text>
      <Text color={COLORS.working} bold>{projectShort}</Text>
      <Text dimColor> · </Text>
      <Text color={COLORS.warning}>{branchShort}</Text>
      <Text dimColor> · </Text>
      <Text color={localColor}>{localIcon} {localLabel}</Text>
    </Text>
  );

  const line2 = (
    <Box justifyContent="space-between">
      {left2}
      {right}
    </Box>
  );

  const line1 = (
    <Box justifyContent="space-between">
      {left1}
      {right1}
    </Box>
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"─".repeat(Math.min(width, 72))}</Text>
      {line1}
      {line2}
    </Box>
  );
}
