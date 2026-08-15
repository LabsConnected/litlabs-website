/**
 * MissionSection — shows the current mission with real lifecycle data.
 *
 * Three display modes:
 *   Idle      — "No active mission"
 *   Running   — mission text, run ID, state, elapsed time, files/commands
 *   Complete  — summary with results (tests, typecheck, build, verification)
 *
 * Uses the semantic color system — purple for brand, cyan for working,
 * green for complete, red for failed.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS, stateColor } from "./colors.js";
import type { HoloState, MissionState } from "./cockpit-store.js";

export interface MissionSectionProps {
  holoState: HoloState;
  mission: string | null;
  missionState: MissionState | null;
  lastCompletedMission: MissionState | null;
}

function formatElapsed(startedAt: number | null, endedAt: number | null): string {
  if (!startedAt) return "00:00";
  const end = endedAt ?? Date.now();
  const seconds = Math.floor((end - startedAt) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shortRunId(id: string | null): string {
  if (!id) return "—";
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function MissionSection({ holoState, mission, missionState, lastCompletedMission }: MissionSectionProps): React.ReactElement {
  const isWorking = holoState === "UNDERSTANDING" || holoState === "PLANNING" || holoState === "READING"
    || holoState === "EDITING" || holoState === "RUNNING" || holoState === "TESTING" || holoState === "VERIFYING";
  const isComplete = holoState === "COMPLETE";
  const isFailed = holoState === "FAILED" || holoState === "CANCELLED" || holoState === "TIMEOUT";

  // ─── Complete/failed: show summary from lastCompletedMission ───
  if ((isComplete || isFailed) && lastCompletedMission) {
    const m = lastCompletedMission;
    const elapsedStr = formatElapsed(m.startedAt, m.endedAt);
    const filesChanged = m.filesTouched.length;
    const commandsRun = m.commandsExecuted.length;

    return (
      <Box flexDirection="column" marginTop={0}>
        <Text bold color={isComplete ? COLORS.success : COLORS.error}>
          {isComplete ? "✓ MISSION COMPLETE" : "✗ MISSION FAILED"}
        </Text>
        <Text dimColor>────────────────────────────────────────────────────────────</Text>
        <Text color={isComplete ? COLORS.success : COLORS.error}>{m.text}</Text>
        <Box flexDirection="column" marginTop={0}>
          {filesChanged > 0 && (
            <Box>
              <Text dimColor>{filesChanged} file{filesChanged !== 1 ? "s" : ""} changed</Text>
            </Box>
          )}
          {m.testResults && (
            <Box>
              <Text color={m.testResults.failed === 0 ? COLORS.success : COLORS.error}>
                {m.testResults.passed}/{m.testResults.total} tests passed
              </Text>
            </Box>
          )}
          {m.typecheckPassed !== null && (
            <Box>
              <Text color={m.typecheckPassed ? COLORS.success : COLORS.error}>
                Typecheck {m.typecheckPassed ? "passed" : "failed"}
              </Text>
            </Box>
          )}
          {m.buildPassed !== null && (
            <Box>
              <Text color={m.buildPassed ? COLORS.success : COLORS.error}>
                Build {m.buildPassed ? "passed" : "failed"}
              </Text>
            </Box>
          )}
          {m.runtimeProven !== null && (
            <Box>
              <Text color={m.runtimeProven ? COLORS.success : COLORS.error}>
                Runtime verification {m.runtimeProven ? "PROVEN" : "NOT PROVEN"}
              </Text>
            </Box>
          )}
          <Box>
            <Text dimColor>Completed in {elapsedStr}</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ─── Running: show live mission status ───
  if (isWorking && missionState) {
    const elapsedStr = formatElapsed(missionState.startedAt, null);
    const stateCol = stateColor(holoState);

    return (
      <Box flexDirection="column" marginTop={0}>
        <Text bold color={COLORS.working}>CURRENT MISSION</Text>
        <Text dimColor>────────────────────────────────────────────────────────────</Text>
        <Text color={COLORS.text}>{missionState.text}</Text>
        <Box marginTop={0}>
          <Text dimColor bold>RUN     </Text>
          <Text color={COLORS.info}>{shortRunId(missionState.runId)}</Text>
          <Text dimColor>   </Text>
          <Text dimColor bold>STATE   </Text>
          <Text color={stateCol}>{holoState}</Text>
          <Text dimColor>   </Text>
          <Text dimColor bold>TIME    </Text>
          <Text color={COLORS.working}>{elapsedStr}</Text>
        </Box>
        {(missionState.filesTouched.length > 0 || missionState.commandsExecuted.length > 0) && (
          <Box marginTop={0}>
            <Text dimColor>
              {missionState.filesTouched.length} file{missionState.filesTouched.length !== 1 ? "s" : ""} touched
              {" · "}
              {missionState.commandsExecuted.length} command{missionState.commandsExecuted.length !== 1 ? "s" : ""} executed
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // ─── Idle: no mission ───
  return (
    <Box flexDirection="column" marginTop={0}>
      <Text bold color={COLORS.brand}>CURRENT MISSION</Text>
      <Text dimColor>────────────────────────────────────────────────────────────</Text>
      <Text dimColor>No active mission</Text>
    </Box>
  );
}
