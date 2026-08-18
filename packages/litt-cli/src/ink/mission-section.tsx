/**
 * MissionSection — shows the current mission as a true projection of
 * the canonical RuntimeStore.mission.
 *
 * RuntimeStore.mission is the ONLY mission authority. This component
 * renders from a MissionProjection — a pure derivation of the canonical
 * mission state. It displays:
 *
 *   goal
 *   status
 *   currentStepId
 *   semantic steps (with per-step status, tool count, file count)
 *   pending / working / passed / blocked / failed counts
 *   verification (PROVEN / NOT PROVEN)
 *   restored/recovered indicator
 *
 * It does NOT mutate mission truth. It does NOT infer lifecycle from
 * toolId strings. It only renders what the canonical store says.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS, stateColor } from "./colors.js";
import type { HoloState, MissionState } from "./cockpit-store.js";
import type { MissionProjection, ProjectedStep } from "./mission-projection.js";

export interface MissionSectionProps {
  holoState: HoloState;
  mission: string | null;
  missionState: MissionState | null;
  lastCompletedMission: MissionState | null;
  /** Canonical mission projection from RuntimeStore.mission.
   *  When present, this is the authoritative view. The legacy
   *  missionState/lastCompletedMission are kept for backward compat
   *  but the projection wins when both are available. */
  missionProjection: MissionProjection | null;
}

function formatElapsed(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt) return "00:00";
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shortRunId(id: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? id.slice(0, 12) : id;
}

const STEP_STATUS_COLOR: Record<ProjectedStep["status"], string> = {
  pending: COLORS.secondary,
  working: COLORS.working,
  verifying: COLORS.info,
  passed: COLORS.success,
  failed: COLORS.error,
  blocked: COLORS.warning,
  skipped: COLORS.secondary,
};

const STEP_STATUS_GLYPH: Record<ProjectedStep["status"], string> = {
  pending: "○",
  working: "▶",
  verifying: "✦",
  passed: "✓",
  failed: "✗",
  blocked: "⚠",
  skipped: "–",
};

export function MissionSection({
  holoState,
  mission,
  missionState,
  lastCompletedMission,
  missionProjection,
}: MissionSectionProps): React.ReactElement {
  // ─── Canonical projection view (authoritative) ───
  if (missionProjection) {
    const p = missionProjection;
    const isComplete = p.status === "complete";
    const isFailed = p.status === "failed" || p.status === "cancelled";
    const isWorking = p.status === "working" || p.status === "planning" || p.status === "verifying";
    const elapsedStr = formatElapsed(p.startedAt, p.completedAt);
    const headerColor = isComplete ? COLORS.success : isFailed ? COLORS.error : COLORS.working;
    const headerLabel = isComplete
      ? "✓ MISSION COMPLETE"
      : isFailed
        ? "✗ MISSION FAILED"
        : p.restored
          ? "↻ MISSION RESTORED"
          : "CURRENT MISSION";

    return (
      <Box flexDirection="column" marginTop={0}>
        <Text bold color={headerColor}>{headerLabel}</Text>
        <Text dimColor>────────────────────────────────────────────────────────────</Text>
        <Text color={COLORS.text}>{p.goal}</Text>
        <Box marginTop={0}>
          <Text dimColor bold>ID      </Text>
          <Text color={COLORS.info}>{shortRunId(p.id)}</Text>
          <Text dimColor>   </Text>
          <Text dimColor bold>STATUS  </Text>
          <Text color={headerColor}>{p.status.toUpperCase()}</Text>
          <Text dimColor>   </Text>
          <Text dimColor bold>TIME    </Text>
          <Text color={COLORS.working}>{elapsedStr}</Text>
        </Box>
        <Box marginTop={0}>
          <Text dimColor>
            {p.passed} passed · {p.working} working · {p.pending} pending · {p.failed} failed · {p.blocked} blocked
          </Text>
        </Box>

        {/* Semantic steps — from canonical mission.steps */}
        {p.steps.length > 0 && (
          <Box flexDirection="column" marginTop={0}>
            {p.steps.map((step) => {
              const isCurrent = step.id === p.currentStepId;
              const glyph = STEP_STATUS_GLYPH[step.status];
              const color = STEP_STATUS_COLOR[step.status];
              const marker = isCurrent ? "▸ " : "  ";
              const toolInfo = step.toolCount > 0 ? ` · ${step.toolCount}t` : "";
              const fileInfo = step.filesChangedCount > 0 ? ` · ${step.filesChangedCount}f` : "";
              return (
                <Box key={step.id}>
                  <Text dimColor>{marker}</Text>
                  <Text color={color}>{glyph} </Text>
                  <Text color={isCurrent ? COLORS.working : COLORS.text}>{step.title}</Text>
                  <Text dimColor>{toolInfo}{fileInfo}</Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Verification truth — from canonical mission.evidence */}
        {p.verificationProven !== null && (
          <Box marginTop={0}>
            <Text color={p.verificationProven ? COLORS.success : COLORS.error}>
              Runtime verification {p.verificationProven ? "PROVEN" : "NOT PROVEN"}
            </Text>
          </Box>
        )}

        {p.completionReason && isComplete && (
          <Box marginTop={0}>
            <Text dimColor>{p.completionReason.slice(0, 80)}</Text>
          </Box>
        )}
        {p.failureReason && isFailed && (
          <Box marginTop={0}>
            <Text color={COLORS.error}>{p.failureReason.slice(0, 80)}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // ─── Legacy fallback (no projection yet) ───
  // Kept for backward compat with surfaces that haven't wired the
  // projection. The projection path above is the authoritative view.
  const isWorking = holoState === "UNDERSTANDING" || holoState === "PLANNING" || holoState === "READING"
    || holoState === "EDITING" || holoState === "RUNNING" || holoState === "TESTING" || holoState === "VERIFYING";
  const isComplete = holoState === "COMPLETE";
  const isFailed = holoState === "FAILED" || holoState === "CANCELLED" || holoState === "TIMEOUT";

  if ((isComplete || isFailed) && lastCompletedMission) {
    const m = lastCompletedMission;
    const elapsedStr = formatElapsed(
      m.startedAt ? new Date(m.startedAt).toISOString() : null,
      m.endedAt ? new Date(m.endedAt).toISOString() : null,
    );
    const filesChanged = m.filesTouched.length;
    return (
      <Box flexDirection="column" marginTop={0}>
        <Text bold color={isComplete ? COLORS.success : COLORS.error}>
          {isComplete ? "✓ MISSION COMPLETE" : "✗ MISSION FAILED"}
        </Text>
        <Text dimColor>────────────────────────────────────────────────────────────</Text>
        <Text color={isComplete ? COLORS.success : COLORS.error}>{m.text}</Text>
        <Box flexDirection="column" marginTop={0}>
          {filesChanged > 0 && (
            <Box><Text dimColor>{filesChanged} file{filesChanged !== 1 ? "s" : ""} changed</Text></Box>
          )}
          {m.runtimeProven !== null && (
            <Box>
              <Text color={m.runtimeProven ? COLORS.success : COLORS.error}>
                Runtime verification {m.runtimeProven ? "PROVEN" : "NOT PROVEN"}
              </Text>
            </Box>
          )}
          <Box><Text dimColor>Completed in {elapsedStr}</Text></Box>
        </Box>
      </Box>
    );
  }

  if (isWorking && missionState) {
    const elapsedStr = formatElapsed(
      missionState.startedAt ? new Date(missionState.startedAt).toISOString() : null,
      null,
    );
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
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={0}>
      <Text bold color={COLORS.brand}>CURRENT MISSION</Text>
      <Text dimColor>────────────────────────────────────────────────────────────</Text>
      <Text dimColor>No active mission</Text>
    </Box>
  );
}
