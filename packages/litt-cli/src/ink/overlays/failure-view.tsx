/**
 * FailureView — the "v View" overlay.
 *
 * When a mission/run fails, the status bar shows `× Failed  v View`.
 * Pressing `v` opens this panel so the operator can see the actual task,
 * reason, last successful step, and a recommended next action.
 */

import React, { useCallback, useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { useOverlayKeyboard } from "../overlay-manager.js";
import { isEnter, isEscape } from "../keyboard-utils.js";
import { COLORS } from "../colors.js";
import { formatFailureReport, buildFailureReport, type FailureReport } from "../../lib/failure-report.js";
import type { MissionState, ActivityEntry } from "../cockpit-store.js";

export interface FailureViewProps {
  mission: MissionState | null;
  lastMission: MissionState | null;
  activityLog: ActivityEntry[];
  onClose: () => void;
}

const TERMINAL_FAILURES = new Set(["FAILED", "CANCELLED", "TIMEOUT"]);

function isTerminalMission(m: MissionState | null): m is MissionState {
  return !!m && TERMINAL_FAILURES.has(m.state);
}

function missionForFailureView(mission: MissionState | null, lastMission: MissionState | null): MissionState | null {
  if (isTerminalMission(mission)) return mission;
  if (isTerminalMission(lastMission)) return lastMission;
  return null;
}

function deriveFailureReason(terminalMission: MissionState, log: ActivityEntry[]): string {
  // Prefer the explicit reason persisted on the mission state.
  if (terminalMission.failureReason) {
    return terminalMission.failureReason;
  }

  // Fall back to the most recent failure-looking activity entry.
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === "mission.failed") {
      const prefix = "Mission FAILED: ";
      return e.text.startsWith(prefix) ? e.text.slice(prefix.length) : e.text;
    }
    if (e.type === "run.failed" || e.type === "tool.failed" || e.tag === "FAIL" || e.type === "error") {
      return e.fullText || e.text;
    }
    if (e.type === "agent.stopped" || (e.type === "agent.complete" && /failed|error/i.test(e.text))) {
      return e.fullText || e.text;
    }
  }

  return terminalMission.state === "CANCELLED" ? "Mission cancelled" : "Mission failed";
}

function deriveLastSuccessfulStep(log: ActivityEntry[], failureIndex: number): string | null {
  // Search the activity log before the failure for the most recent success.
  for (let i = failureIndex - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === "mission.step_passed") return e.text;
    if (e.type === "tool.completed" || e.type === "run.completed" || e.tag === "PASS" || e.type === "verification.passed") {
      const text = e.fullText || e.text;
      // Strip trailing " · 58ms" / ": passed" noise for display.
      return text.replace(/\s*·\s*\d+ms$/, "").replace(/:\s*passed\.?$/, "");
    }
  }
  return null;
}

function findFailureEntry(log: ActivityEntry[]): { entry: ActivityEntry | null; index: number } {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (
      e.type === "mission.failed"
      || e.type === "run.failed"
      || e.type === "tool.failed"
      || e.tag === "FAIL"
      || e.type === "error"
    ) {
      return { entry: e, index: i };
    }
  }
  return { entry: null, index: -1 };
}

function deriveFailedStep(failureEntry: ActivityEntry | null, terminalMission: MissionState): string | null {
  if (failureEntry?.type === "mission.step_failed") return failureEntry.text;
  if (failureEntry?.type === "tool.failed") {
    // Event text is formatted as "<tool label> — <error>".
    const [label] = failureEntry.text.split(" — ");
    if (label) return label.trim();
  }
  if (failureEntry?.type === "tool.timeout" || failureEntry?.type === "tool.cancelled") {
    // Event text is formatted as "<tool label> · <detail>".
    const [label] = failureEntry.text.split(" · ");
    if (label) return label.trim();
  }
  // Fall back to the last command the mission executed, if any.
  const lastCommand = terminalMission.commandsExecuted?.[terminalMission.commandsExecuted.length - 1];
  if (lastCommand) return lastCommand;
  return null;
}

function deriveCommandExcerpt(_failureEntry: ActivityEntry | null, terminalMission: MissionState): string | null {
  return terminalMission.commandsExecuted?.[terminalMission.commandsExecuted.length - 1] ?? null;
}

function deriveOutputExcerpt(failureEntry: ActivityEntry | null, reason: string): string | null {
  const candidate = failureEntry?.fullText ?? failureEntry?.text;
  if (candidate && candidate !== reason) {
    return candidate.length > 400 ? `${candidate.slice(0, 397)}…` : candidate;
  }
  return null;
}

export function buildFailureViewReport(
  terminalMission: MissionState,
  log: ActivityEntry[],
): FailureReport {
  const task = terminalMission.text || "Mission";
  const reason = deriveFailureReason(terminalMission, log);
  const { entry: failureEntry, index: failureEntryIndex } = findFailureEntry(log);

  const lastSuccessfulStep = failureEntryIndex >= 0
    ? deriveLastSuccessfulStep(log, failureEntryIndex)
    : deriveLastSuccessfulStep(log, log.length);

  const failedStep = deriveFailedStep(failureEntry, terminalMission);
  const commandExcerpt = deriveCommandExcerpt(failureEntry, terminalMission);
  const outputExcerpt = deriveOutputExcerpt(failureEntry, reason);

  return buildFailureReport(
    task,
    reason,
    lastSuccessfulStep,
    terminalMission.runId,
    failedStep,
    commandExcerpt,
    outputExcerpt,
  );
}

export function FailureView({ mission, lastMission, activityLog, onClose }: FailureViewProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const terminalMission = useMemo(() => missionForFailureView(mission, lastMission), [mission, lastMission]);
  const reportText = useMemo(() => {
    if (!terminalMission) return "No failure details available.";
    return formatFailureReport(buildFailureViewReport(terminalMission, activityLog));
  }, [terminalMission, activityLog]);

  useOverlayKeyboard("failure-view", useCallback((input, key) => {
    if (isEnter(key, input) || isEscape(key, input) || input === "v" || input === "V" || input === "q") {
      onClose();
    }
  }, [onClose]));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.error} paddingX={2} paddingY={1}>
      <Text bold color={COLORS.error}>Failure details</Text>
      <Box marginTop={1} flexDirection="column">
        {reportText.split("\n").map((line, i) => {
          const isHeading = line === "FAILED" || line.endsWith(":") || line.startsWith("Run ID:");
          return (
            <Text key={i} color={isHeading ? COLORS.textBright : COLORS.text} bold={isHeading}>
              {line.length > width - 6 ? `${line.slice(0, width - 7)}…` : line}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc / Enter / v close</Text>
      </Box>
    </Box>
  );
}
