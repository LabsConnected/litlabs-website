/**
 * StatusBar — the LiTT shell's two-line bottom bar.
 *
 * ```
 *   LiTT Auto → GPT-5.6 Luna                    ○ Plan   ● Act
 *   litlabs-website · feat/litt-final-integration · LOCAL    clean
 * ```
 *
 * Hierarchy (never everything bright):
 *   brain        — white + subtle orange identity
 *   active model — white
 *   Plan/Act     — active orange, inactive dim gray
 *   project      — gray
 *   branch       — slightly brighter gray
 *   LOCAL        — muted, state-colored
 *   clean        — muted green
 *   dirty        — muted amber (+N)
 *   working      — small active indicator (◉ Working · Ns)
 *   error        — muted red (! failed · v View)
 *
 * One dim divider above. No fake statuses — everything comes from
 * canonical state. Left/right segments never overlap: the left side
 * truncates to the width the right side leaves.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import { truncateTail, shortModelName } from "./text-wrap.js";
import type { HoloState, MissionState } from "./cockpit-store.js";

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

  // ── Line 2 right: clean / +N / ◉ Working / ! failed ──
  let right: React.ReactElement;
  if (working) {
    const started = busySince ?? missionState?.startedAt ?? Date.now();
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    right = (
      <Text color={COLORS.working}>
        ◉ Working · {seconds}s
      </Text>
    );
  } else if (missionState
    && (missionState.state === "FAILED" || missionState.state === "CANCELLED" || missionState.state === "TIMEOUT")) {
    const label = missionState.state === "FAILED" ? "failed" : missionState.state.toLowerCase();
    const tests = missionState.testResults && missionState.testResults.failed > 0
      ? ` · ${missionState.testResults.failed} test${missionState.testResults.failed !== 1 ? "s" : ""} failing`
      : "";
    right = (
      <Text>
        <Text color={COLORS.error}>! {label}{tests}</Text>
        <Text dimColor>  v View</Text>
      </Text>
    );
  } else if (gitModified + gitUntracked > 0) {
    right = <Text color={COLORS.warning}>+{gitModified + gitUntracked}</Text>;
  } else {
    right = <Text color={COLORS.success} dimColor={!busy}>clean</Text>;
  }

  // ── Line 1: brain → active   |   Plan/Act ──
  const modelShort = activeModel ? shortModelName(activeModel) : null;
  const planDot = mode === "plan" ? "●" : "○";
  const actDot = mode === "act" ? "●" : "○";
  const right1Text = `${planDot} Plan   ${actDot} Act`;

  // ── Line 2: project · branch · LOCAL   |   right status ──
  const localIcon = localRuntime === "ready" ? "●" : localRuntime === "error" ? "✗" : "○";
  const localColor = localRuntime === "ready" ? COLORS.success
    : localRuntime === "error" ? COLORS.error : COLORS.warning;
  const localLabel = localRuntime === "ready" ? "LOCAL"
    : localRuntime === "error" ? "LOCAL ERR" : "LOCAL…";

  // Right-segment widths for overlap-free truncation.
  const rightWidth = Math.max(5, measure(right));
  const right1Width = right1Text.length;
  const left1Max = Math.max(20, width - 4 - right1Width);
  const left2Max = Math.max(24, width - 4 - rightWidth);

  const left1 = (
    <Text>
      <Text color={COLORS.brand} bold>{truncateTail(brain, Math.max(12, Math.floor(left1Max * 0.4)))}</Text>
      {modelShort && (
        <>
          <Text dimColor> → </Text>
          <Text color={COLORS.text}>{truncateTail(modelShort, Math.max(8, left1Max - 18))}</Text>
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

  const projectShort = truncateTail(project, Math.max(10, Math.floor(left2Max * 0.42)));
  const branchShort = truncateTail(branch, Math.max(10, Math.floor(left2Max * 0.36)));

  const left2 = (
    <Text>
      <Text color={COLORS.secondary}>{projectShort}</Text>
      <Text dimColor> · </Text>
      <Text color={COLORS.secondaryBright}>{branchShort}</Text>
      <Text dimColor> · </Text>
      <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}</Text>
    </Text>
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.secondaryDim}>{"─".repeat(Math.max(20, Math.min(width - 4, 72)))}</Text>
      <Box justifyContent="space-between">
        {left1}
        {right1}
      </Box>
      <Box justifyContent="space-between">
        {left2}
        {right}
      </Box>
    </Box>
  );
}

/** Rough visual width of a React element subtree (text lengths only). */
function measure(node: React.ReactElement): number {
  let total = 0;
  const walk = (n: React.ReactNode): void => {
    if (n == null || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") { total += String(n).length; return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (React.isValidElement(n)) {
      const props = n.props as { children?: React.ReactNode };
      if (typeof props.children === "string") total += props.children.length;
      else walk(props.children);
    }
  };
  walk(node);
  return total;
}

// Re-export for consumers that need the friendly label logic.
export { shortModelName };
