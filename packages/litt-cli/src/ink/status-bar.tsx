/**
 * StatusBar — the LiTT shell's single-line bottom bar.
 *
 * ```
 *   Act · ask before changes                    / commands  ? help
 *   Plan · read-only                            ◆ Running · 0:12
 *   Act · ask before changes                    ⚠ APPROVAL · waiting 0:40
 *   Act · ask before changes                    × failed · v View
 * ```
 *
 * Left: the mode and the permission it actually grants — "Plan" means
 * read-only (mutations are denied at the gateway), "Act" means the run
 * executes with approval prompts at restricted actions. "Act" alone
 * never implies unrestricted execution.
 *
 * Right: the ONE authoritative runtime state (runtime-state.ts) while
 * a run is live or terminal; the quiet `/ commands ? help` hints when
 * idle. Approval wait is gold and never rendered as active execution;
 * approval-wait time is excluded from the working clock.
 *
 * Everything else moved out of the footer: project/branch/git state
 * live in the header identity bar, model/provider in the reply
 * metadata and /status.
 */

import React from "react";
import { clockIntervalMs } from "./motion.js";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import type { HoloState, MissionState } from "./cockpit-store.js";
import {
  deriveRuntimeState, isBusyState, isTerminalState, runtimeGlyph, runtimeLabel,
  formatDuration, approvalWaitSeconds, busySecondsExcludingApproval,
  type RuntimeState,
} from "./runtime-state.js";

export interface StatusBarProps {
  project: string;
  branch: string;
  localRuntime: string;
  /** Remote transport state — retained for call-site compatibility. */
  remoteRuntime?: string;
  holoState: HoloState;
  brain: string;
  activeModel: string | null;
  /** The provider that ACTUALLY served the most recent request. */
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
  holoState, mode, isProcessing, busySince,
  approvalSince = null, approvalAccumMs = 0, approvalCount = 0, missionState,
}: StatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  // ── ONE authoritative runtime state — never a self-derived status ──
  const hasApproval = approvalSince !== null || holoState === "APPROVAL";
  const runtime: RuntimeState = deriveRuntimeState({
    holoState,
    isProcessing,
    missionState,
    hasApproval,
  });
  const busy = isBusyState(runtime) || isTerminalState(runtime);

  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, clockIntervalMs(1000));
    return () => clearInterval(timer);
  }, [busy]);

  // ── Clock math — approval wait is NOT work time ──
  const now = Date.now();
  const activeSeconds = busySecondsExcludingApproval(
    busySince ?? missionState?.startedAt ?? null,
    approvalSince,
    approvalAccumMs,
    now,
  );
  const waitSeconds = approvalWaitSeconds(approvalSince, now);

  // Right side: runtime truth while live/terminal, hints when idle.
  let right: React.ReactElement;
  if (runtime === "waiting_for_approval") {
    const countSuffix = approvalCount > 1 ? ` · ${approvalCount} pending` : "";
    right = (
      <Text color={COLORS.gold} bold>
        {`${runtimeGlyph(runtime)} ${runtimeLabel(runtime)} · waiting ${formatDuration(waitSeconds)}${countSuffix}`}
      </Text>
    );
  } else if (runtime === "planning" || runtime === "running" || runtime === "verifying") {
    right = (
      <Text color={COLORS.brand}>
        {`${runtimeGlyph(runtime)} ${runtimeLabel(runtime)} · ${formatDuration(activeSeconds)}`}
      </Text>
    );
  } else if (runtime === "completed") {
    right = (
      <Text color={COLORS.success} dimColor>{`${runtimeGlyph(runtime)} ${runtimeLabel(runtime)}`}</Text>
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
  } else {
    right = (
      <Text dimColor>{width >= 60 ? "/ commands  ? help" : "? help"}</Text>
    );
  }

  // Left: mode + the permission it actually grants.
  return (
    <Box justifyContent="space-between">
      <Text>
        <Text color={COLORS.brand} bold>{mode === "plan" ? "Plan" : "Act"}</Text>
        <Text dimColor>{mode === "plan" ? " · read-only" : " · ask before changes"}</Text>
      </Text>
      {right}
    </Box>
  );
}

// Re-export for consumers that need the friendly label logic.
export { shortModelName } from "./text-wrap.js";
