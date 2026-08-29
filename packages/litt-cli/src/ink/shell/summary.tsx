/**
 * Summary — the compact result block after a mission terminates.
 *
 * ```
 *   COMPLETE
 *     ✓ verification passed
 *     2 files changed · 14.2s
 *     22 tests passed
 *     typecheck passed
 *
 *   COMPLETE WITH ISSUES
 *     ✓ Repository inspected
 *     ! Tests were not executed
 *
 *   FAILED
 *     × Verification failed
 *     × 1 test still failing
 *
 *     /diff    review changes
 *     /verify  retry checks
 * ```
 *
 * Rendered from canonical mission state (never invented): git counts
 * from the workspace, test/typecheck/build results from the
 * VerificationGate, runtime provenance from the mission itself.
 *
 * VERIFICATION GATE: A mission may only show "COMPLETE" if verification
 * actually passed. If verification is incomplete (tests not run, runtime
 * not proven), the header says "COMPLETE WITH ISSUES" or "NOT VERIFIED"
 * — NEVER "COMPLETE". Git clean ≠ task complete.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../colors.js";
import type { MissionState } from "../cockpit-store.js";

function line(ok: boolean | null, label: string, glyph = "✓"): React.ReactElement | null {
  if (ok === null) return null;
  return (
    <Box>
      <Text color={ok ? COLORS.success : COLORS.error}>{`  ${ok ? glyph : "×"} `}</Text>
      <Text color={ok ? COLORS.text : COLORS.error}>{label}</Text>
    </Box>
  );
}

export interface MissionResultBlockProps {
  mission: MissionState;
  gitModified: number;
  gitUntracked: number;
}

/** Files + git delta summary line. */
function changeLine(mission: MissionState, gitModified: number, gitUntracked: number): React.ReactElement | null {
  const touched = mission.filesTouched.length;
  const total = gitModified + gitUntracked;
  if (touched === 0 && total === 0) return null;
  const n = touched > 0 ? touched : total;
  const label = `${n} file${n !== 1 ? "s" : ""} changed`;
  return (
    <Box>
      <Text color={COLORS.text}>{`  ${label}`}</Text>
    </Box>
  );
}

/**
 * The honest mission file delta. Uses the baseline-vs-terminal git
 * comparison (missionDeltaFiles) — NEVER the raw repository dirty count
 * (pre-existing changes are not the mission's).
 */
function missionDeltaLine(mission: MissionState): React.ReactElement | null {
  const delta = mission.missionDeltaFiles;
  if (delta === null) return null;
  if (delta.length === 0) return null; // read-only/clean — omit, don't claim
  const n = delta.length;
  return (
    <Box>
      <Text color={COLORS.text}>{`  ${n} file${n !== 1 ? "s" : ""} changed by this mission`}</Text>
    </Box>
  );
}

/**
 * The honest verification line. Read-only missions never claim
 * "verification passed" for code changes — they did not run a mutation
 * gate; the evidence gate verified the INSPECTION. Only mutating
 * missions with runtimeProven=true get "verification passed".
 */
function verificationLine(mission: MissionState): React.ReactElement | null {
  if (mission.runtimeProven === null) return null;
  if (mission.readOnly) {
    return mission.runtimeProven
      ? <Box><Text color={COLORS.success}>{"  ✓ "}</Text><Text color={COLORS.text}>inspection verified</Text></Box>
      : <Box><Text color={COLORS.error}>{"  × "}</Text><Text color={COLORS.error}>inspection not verified</Text></Box>;
  }
  return line(mission.runtimeProven, mission.runtimeProven ? "verification passed" : "verification failed");
}

/** Read-only mission summary: what was actually done, honestly. */
function readOnlyLine(mission: MissionState): React.ReactElement | null {
  if (!mission.readOnly) return null;
  if (mission.toolsUsed.length === 0) return null;
  const n = mission.toolsUsed.length;
  return (
    <Box>
      <Text color={COLORS.text}>{`  ${n} tool${n !== 1 ? "s" : ""} used`}</Text>
    </Box>
  );
}

/** Format elapsed milliseconds as "14.2s" or "1m 23s". */
function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

/** Run metrics line: "3 files changed · 14.2s · 9 tools" */
function metricsLine(mission: MissionState): React.ReactElement | null {
  const delta = mission.missionDeltaFiles;
  const fileCount = delta !== null ? delta.length : mission.filesTouched.length;
  const elapsed = mission.startedAt && mission.endedAt
    ? mission.endedAt - mission.startedAt
    : null;
  const toolCount = mission.toolsUsed.length;
  const cmdCount = mission.commandsExecuted.length;

  const parts: string[] = [];
  if (fileCount > 0) parts.push(`${fileCount} file${fileCount !== 1 ? "s" : ""} changed`);
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  if (cmdCount > 0) parts.push(`${cmdCount} command${cmdCount !== 1 ? "s" : ""}`);
  const elapsedStr = formatElapsed(elapsed);
  if (elapsedStr) parts.push(elapsedStr);

  if (parts.length === 0) return null;
  return (
    <Box>
      <Text dimColor>{`  ${parts.join(" · ")}`}</Text>
    </Box>
  );
}

/**
 * Determine the honest header. A mission may only say "COMPLETE" if
 * verification actually passed. If verification is incomplete, the
 * header reflects that — "COMPLETE WITH ISSUES" or "NOT VERIFIED".
 */
function deriveHeader(mission: MissionState): { text: string; color: string } {
  const state = mission.state;

  if (state === "FAILED") return { text: "FAILED", color: COLORS.error };
  if (state === "CANCELLED") return { text: "CANCELLED", color: COLORS.error };
  if (state === "TIMEOUT") return { text: "TIMEOUT", color: COLORS.error };

  // state === "COMPLETE" — but is verification actually proven?
  if (mission.readOnly) {
    // Read-only: "inspection verified" is the gate
    if (mission.runtimeProven === true) return { text: "COMPLETE", color: COLORS.success };
    if (mission.runtimeProven === false) return { text: "FAILED", color: COLORS.error };
    // runtimeProven === null — inspection not verified
    return { text: "NOT VERIFIED", color: COLORS.gold };
  }

  // Mutating mission: verification gate must pass
  if (mission.runtimeProven === true) return { text: "COMPLETE", color: COLORS.success };
  if (mission.runtimeProven === false) return { text: "FAILED", color: COLORS.error };

  // runtimeProven === null — verification was not run
  // Check if at least some checks passed
  const hasTests = mission.testResults !== null;
  const hasTypecheck = mission.typecheckPassed !== null;
  const hasBuild = mission.buildPassed !== null;

  if (hasTests || hasTypecheck || hasBuild) {
    // Some checks ran but runtime was not proven
    return { text: "COMPLETE WITH ISSUES", color: COLORS.gold };
  }

  // No verification ran at all
  return { text: "NOT VERIFIED", color: COLORS.gold };
}

/** The honest result block. */
export function MissionResultBlock({ mission, gitModified, gitUntracked }: MissionResultBlockProps): React.ReactElement {
  const state = mission.state;
  const { text: header, color: headerColor } = deriveHeader(mission);
  const isComplete = header === "COMPLETE";

  const failedTests = mission.testResults && mission.testResults.failed > 0
    ? mission.testResults.failed
    : 0;
  const passedTests = mission.testResults ? mission.testResults.passed : 0;

  return (
    <Box flexDirection="column">
      <Text bold color={headerColor}>{header}</Text>

      {/* Proof lines — only what the evidence actually supports.
          READ-ONLY: inspection verified + tools used (never a mutation
          verification, never pre-existing repo dirt).
          MUTATING:  verification passed ONLY when the gate proved it;
          mission delta = baseline vs terminal git snapshot. */}
      {verificationLine(mission)}
      {readOnlyLine(mission)}
      {!mission.readOnly && missionDeltaLine(mission)}
      {mission.testResults && (
        <Box>
          <Text color={failedTests === 0 ? COLORS.success : COLORS.error}>{`  ${failedTests === 0 ? "✓" : "×"} `}</Text>
          <Text color={failedTests === 0 ? COLORS.text : COLORS.error}>
            {failedTests === 0 ? `${passedTests} tests passed` : `${failedTests} test${failedTests !== 1 ? "s" : ""} still failing`}
          </Text>
        </Box>
      )}
      {line(mission.typecheckPassed, "typecheck passed")}
      {line(mission.buildPassed, "build passed")}

      {/* Incomplete verification warnings */}
      {!isComplete && state === "COMPLETE" && (
        <Box flexDirection="column">
          {mission.testResults === null && !mission.readOnly && (
            <Box><Text color={COLORS.gold}>{"  ! "}</Text><Text color={COLORS.gold}>Tests were not executed</Text></Box>
          )}
          {mission.typecheckPassed === null && !mission.readOnly && (
            <Box><Text color={COLORS.gold}>{"  ! "}</Text><Text color={COLORS.gold}>Typecheck was not run</Text></Box>
          )}
          {mission.runtimeProven === null && !mission.readOnly && (
            <Box><Text color={COLORS.gold}>{"  ! "}</Text><Text color={COLORS.gold}>Runtime behavior not proven</Text></Box>
          )}
        </Box>
      )}

      {/* Run metrics */}
      {metricsLine(mission)}

      {/* Failed-state next actions */}
      {state === "FAILED" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"  /diff    review changes"}</Text>
          <Text dimColor>{"  /verify  retry checks"}</Text>
        </Box>
      )}
    </Box>
  );
}

// ─── Backward-compat exports (kept for any legacy importers) ────────

export interface ChangeSummaryProps {
  mission: MissionState;
  gitModified: number;
  gitUntracked: number;
}

/** Files + git delta summary. */
export function ChangeSummary({ mission, gitModified, gitUntracked }: ChangeSummaryProps): React.ReactElement | null {
  return changeLine(mission, gitModified, gitUntracked);
}

export interface VerificationSummaryProps {
  mission: MissionState;
}

/** VerificationGate results — honest pass/fail, never fabricated. */
export function VerificationSummary({ mission }: VerificationSummaryProps): React.ReactElement | null {
  const { testResults, typecheckPassed, buildPassed, runtimeProven } = mission;
  if (!testResults && typecheckPassed === null && buildPassed === null && runtimeProven === null) {
    return null;
  }
  return (
    <Box flexDirection="column">
      {line(runtimeProven, "verification passed")}
      {testResults && (
        <Box>
          <Text color={testResults.failed === 0 ? COLORS.success : COLORS.error}>
            {`  ${testResults.failed === 0 ? "✓" : "×"} `}
          </Text>
          <Text>
            {testResults.passed} passed · {testResults.failed} failed
          </Text>
        </Box>
      )}
      {line(typecheckPassed, "typecheck passed")}
      {line(buildPassed, "build passed")}
    </Box>
  );
}
