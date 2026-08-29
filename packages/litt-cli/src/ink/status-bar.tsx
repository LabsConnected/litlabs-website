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
 *   working      — small active indicator (◆ Running · m:ss). Excludes
 *                  approval-wait time — blocked-on-human is NOT work time.
 *   waiting      — gold (⚠ APPROVAL · waiting m:ss). Mutually exclusive
 *                  with "Working": a pending approval is never rendered
 *                  as active execution.
 *   error        — muted red (× failed · v View)
 *
 * One dim divider above. No fake statuses — everything comes from
 * canonical state. Left/right segments never overlap: the left side
 * truncates to the width the right side leaves.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import { truncateTail, shortModelName } from "./text-wrap.js";
import { providerLabel } from "../lib/model-provider.js";
import type { HoloState, MissionState } from "./cockpit-store.js";
import { deriveTransport } from "../lib/transport-projection.js";
import {
  deriveRuntimeState, isBusyState, isTerminalState, runtimeGlyph, runtimeLabel, runtimeColorRole,
  formatDuration, approvalWaitSeconds, busySecondsExcludingApproval,
  type RuntimeState,
} from "./runtime-state.js";

export interface StatusBarProps {
  project: string;
  branch: string;
  localRuntime: string;
  /** Remote transport state — required so the footer cannot contradict the header. */
  remoteRuntime?: string;
  holoState: HoloState;
  brain: string;
  activeModel: string | null;
  /** The provider that ACTUALLY served the most recent request (e.g. "openai"). */
  activeProvider: string | null;
  mode: "plan" | "act";
  isProcessing: boolean;
  busySince: number | null;
  /** Epoch ms when the current approval window opened (null = none). */
  approvalSince: number | null;
  /** Total ms already spent waiting on RESOLVED approvals this run. */
  approvalAccumMs: number;
  /** Total approvals pending (1 = just this one). */
  approvalCount: number;
  missionState: MissionState | null;
  gitModified: number;
  gitUntracked: number;
}

export function StatusBar({
  project, branch, localRuntime, remoteRuntime = "offline", holoState, brain, activeModel, activeProvider,
  mode, isProcessing, busySince, approvalSince = null, approvalAccumMs = 0, approvalCount = 0, missionState,
  gitModified, gitUntracked,
}: StatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  // ── ONE authoritative runtime state — never a self-derived status ──
  // Approval, working, and terminal states are decided by the shared
  // derivation, so the footer can never say "Working" while waiting for
  // approval or after the mission has ended. A live approval-wait clock
  // (approvalSince) OR the APPROVAL holo phase pins the waiting state.
  const hasApproval = approvalSince !== null || holoState === "APPROVAL";
  const runtime: RuntimeState = deriveRuntimeState({
    holoState,
    isProcessing,
    missionState,
    hasApproval,
  });
  const working = isBusyState(runtime) && runtime !== "waiting_for_approval";
  const busy = isBusyState(runtime) || isTerminalState(runtime);

  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // ── Clock math — approval wait is NOT work time ──
  // "Working · Ns" excludes open + accumulated approval windows, so a
  // 3-minute decision never inflates agent execution time.
  const now = Date.now();
  const activeSeconds = busySecondsExcludingApproval(
    busySince ?? missionState?.startedAt ?? null,
    approvalSince,
    approvalAccumMs,
    now,
  );
  const waitSeconds = approvalWaitSeconds(approvalSince, now);

  // ── Line 2 right: ⚠ APPROVAL / ◆ Running / ✓ Done / × failed / git ──
  let right: React.ReactElement;
  if (runtime === "waiting_for_approval") {
    // Gold — attention is required. NEVER "Working" here. The duration
    // counts ONLY the approval wait, and the pending count surfaces
    // queued approvals ("· 2 pending") so depth is never invisible.
    const countSuffix = approvalCount > 1 ? ` · ${approvalCount} pending` : "";
    right = (
      <Text color={COLORS.gold} bold>
        {`${runtimeGlyph(runtime)} ${runtimeLabel(runtime)} · waiting ${formatDuration(waitSeconds)}${countSuffix}`}
      </Text>
    );
  } else if (runtime === "planning" || runtime === "running" || runtime === "verifying") {
    // Purple ◆ — active LiTT work, duration secondary, approval-free.
    right = (
      <Text color={COLORS.brand}>
        {`${runtimeGlyph(runtime)} ${runtimeLabel(runtime)} · ${formatDuration(activeSeconds)}`}
      </Text>
    );
  } else if (runtime === "completed") {
    right = (
      <Text color={COLORS.success} dimColor={!busy}>
        {`${runtimeGlyph(runtime)} ${runtimeLabel(runtime)}`}
      </Text>
    );
  } else if (runtime === "failed" || runtime === "cancelled" || runtime === "timeout") {
    const tests = missionState?.testResults && missionState.testResults.failed > 0
      ? ` · ${missionState.testResults.failed} test${missionState.testResults.failed !== 1 ? "s" : ""} failing`
      : "";
    right = (
      <Text>
        <Text color={COLORS.error}>{`${runtimeGlyph(runtime)} ${runtimeLabel(runtime)}${tests}`}</Text>
        <Text dimColor>  v View</Text>
      </Text>
    );
  } else if (gitModified + gitUntracked > 0) {
    // Dirty state: subtle dim warning, not visually dominant.
    right = <Text dimColor color={COLORS.warning}>+{gitModified + gitUntracked}</Text>;
  } else {
    right = <Text color={COLORS.success} dimColor={!busy}>clean</Text>;
  }
  // runtimeColorRole is the semantic contract used by tests — the footer
  // must render each state in its declared role color.
  void runtimeColorRole(runtime);

  // ── Line 1: model · PROVIDER   |   Plan/Act ──
  // Per spec: don't show "LiTT Auto →" — the user knows it's LiTT.
  // Show the model and real provider: "GPT-5.6 Luna · OpenAI"
  // If no model is active yet, show the brain label (routing mode).
  const modelShort = activeModel ? shortModelName(activeModel) : null;
  const providerShort = activeProvider ? providerLabel(activeProvider) : null;
  const planDot = mode === "plan" ? "●" : "○";
  const actDot = mode === "act" ? "●" : "○";
  const right1Text = `${planDot} Plan   ${actDot} Act`;

  // ── Line 2: project · branch · LOCAL   |   right status ──
  // Footer label comes from the SHARED projection — never derived here.
  // This is what makes "header says REMOTE, footer says LOCAL" structurally
  // impossible rather than merely unlikely.
  const transport = deriveTransport({ localRuntime, remoteRuntime });
  const localIcon = transport.footerSeverity === "ok" ? "●"
    : transport.footerSeverity === "error" ? "✗" : "○";
  const localColor = transport.footerSeverity === "ok" ? COLORS.success
    : transport.footerSeverity === "error" ? COLORS.error : COLORS.warning;
  const localLabel = transport.footerLabel;

  // Right-segment widths for overlap-free truncation.
  const rightWidth = Math.max(5, measure(right));
  const right1Width = right1Text.length;
  const left1Max = Math.max(20, width - 4 - right1Width);
  const left2Max = Math.max(24, width - 4 - rightWidth);

  // Line 1 left: model · provider (or brain label if no model active yet)
  const left1 = modelShort ? (
    <Text>
      <Text color={COLORS.text}>{truncateTail(modelShort, Math.max(8, left1Max - (providerShort ? providerShort.length + 3 : 0)))}</Text>
      {providerShort && (
        <>
          <Text dimColor> · </Text>
          <Text color={COLORS.secondaryBright}>{providerShort}</Text>
        </>
      )}
    </Text>
  ) : (
    <Text>
      <Text color={COLORS.brand} bold>{truncateTail(brain, Math.max(12, Math.floor(left1Max * 0.6)))}</Text>
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
