/**
 * Summary — the compact result block after a mission terminates.
 *
 * ```
 *   DONE
 *     ✓ verification passed
 *     2 files changed
 *     22 tests passed
 *     typecheck passed
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
 * DONE is only shown when the evidence justifies it — the header
 * always says what actually happened (DONE / FAILED / CANCELLED / TIMEOUT).
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

/** The honest result block. */
export function MissionResultBlock({ mission, gitModified, gitUntracked }: MissionResultBlockProps): React.ReactElement {
  const state = mission.state;
  const isSuccess = state === "COMPLETE";
  const header = state === "COMPLETE"
    ? "DONE"
    : state === "FAILED"
      ? "FAILED"
      : state === "CANCELLED"
        ? "CANCELLED"
        : "TIMEOUT";
  const headerColor = isSuccess ? COLORS.success : COLORS.error;

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

      {/* Failed-state next actions */}
      {!isSuccess && state !== "CANCELLED" && state !== "TIMEOUT" && (
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
