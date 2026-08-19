/**
 * Summary — the DONE block after a mission completes.
 *
 *   DONE
 *
 *     2 files changed
 *     22 tests passed
 *     typecheck passed
 *
 * Rendered from canonical mission state (never invented): git counts
 * from the workspace, test/typecheck/build results from the
 * VerificationGate, runtime provenance from the mission itself.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../colors.js";
import type { MissionState } from "../cockpit-store.js";

function line(label: string, ok: boolean | null): React.ReactElement | null {
  if (ok === null) return null;
  return (
    <Box>
      <Text color={ok ? COLORS.success : COLORS.error}>{ok ? "  ✓ " : "  × "}</Text>
      <Text color={ok ? COLORS.text : COLORS.error}>{label}</Text>
    </Box>
  );
}

export interface ChangeSummaryProps {
  mission: MissionState;
  gitModified: number;
  gitUntracked: number;
}

/** Files + git delta summary. */
export function ChangeSummary({ mission, gitModified, gitUntracked }: ChangeSummaryProps): React.ReactElement | null {
  const touched = mission.filesTouched.length;
  const total = gitModified + gitUntracked;
  if (touched === 0 && total === 0) return null;
  const label = touched > 0
    ? `${touched} file${touched !== 1 ? "s" : ""} changed`
    : `${total} change${total !== 1 ? "s" : ""}`;
  return (
    <Box>
      <Text color={COLORS.working}>  → </Text>
      <Text>{label}</Text>
    </Box>
  );
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
      {testResults && (
        <Box>
          <Text color={testResults.failed === 0 ? COLORS.success : COLORS.error}>
            {testResults.failed === 0 ? "  ✓ " : "  × "}
          </Text>
          <Text>
            {testResults.passed} passed · {testResults.failed} failed
          </Text>
        </Box>
      )}
      {line("typecheck passed", typecheckPassed)}
      {line("build passed", buildPassed)}
      {line("runtime verified", runtimeProven)}
    </Box>
  );
}
