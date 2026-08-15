/**
 * WorkingView — the expanded layout shown only while LiTT is busy.
 *
 * Replaces the old always-on dashboard. When LiTT is idle, the cockpit
 * shows a minimal logo + prompt (see app.tsx). When LiTT is working
 * (isProcessing || holoState != IDLE), this view expands to show:
 *
 *   REQUEST     — what the user asked
 *   THINKING    — lifecycle step tree (Understand → Inspect → Plan → …)
 *   ACTIVITY    — live operator feed (real runtime events, no fakes)
 *   TERMINAL    — last command + its result
 *
 * Everything displayed comes from the real runtime (cockpit-store).
 * No fabricated statuses.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS, stateColor, activityColor } from "./colors.js";
import type { HoloState, MissionState, ActivityEntry } from "./cockpit-store.js";

// ─── Lifecycle step tree ───────────────────────────────────────────

const STEPS = [
  { label: "Inspecting project", states: ["UNDERSTANDING", "READING"] },
  { label: "Reading architecture", states: ["READING"] },
  { label: "Building execution plan", states: ["PLANNING"] },
  { label: "Editing", states: ["EDITING"] },
  { label: "Running", states: ["RUNNING"] },
  { label: "Testing", states: ["TESTING"] },
  { label: "Verifying", states: ["VERIFYING"] },
];

const STEP_ORDER = ["UNDERSTANDING", "READING", "PLANNING", "EDITING", "RUNNING", "TESTING", "VERIFYING"];

function stepStatus(state: HoloState, stepIdx: number): "done" | "active" | "pending" {
  if (state === "COMPLETE") return "done";
  if (state === "FAILED" || state === "CANCELLED" || state === "TIMEOUT") {
    // Mark steps up to the failure point as done
    return "pending";
  }
  const idx = STEP_ORDER.indexOf(state);
  if (idx < 0) return "pending";
  if (stepIdx < idx) return "done";
  if (stepIdx === idx) return "active";
  return "pending";
}

function ThinkingTree({ state }: { state: HoloState }): React.ReactElement {
  const color = stateColor(state);
  const isTerminal = state === "COMPLETE" || state === "FAILED" || state === "CANCELLED" || state === "TIMEOUT";

  if (isTerminal) {
    const label = state === "COMPLETE" ? "Done" : state === "FAILED" ? "Failed" : state === "CANCELLED" ? "Cancelled" : "Timeout";
    const icon = state === "COMPLETE" ? "✓" : "✗";
    const c2 = state === "COMPLETE" ? COLORS.success : COLORS.error;
    return (
      <Box flexDirection="column">
        <Text color={COLORS.secondary} bold>THINKING</Text>
        <Text color={c2} bold>{`  ${icon} ${label}`}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={COLORS.secondary} bold>THINKING</Text>
      {STEPS.map((step, i) => {
        const status = stepStatus(state, i);
        const isLast = i === STEPS.length - 1;
        const branch = isLast ? "└─" : "├─";
        const icon = status === "done" ? "✓" : status === "active" ? "●" : "○";
        const sc = status === "done" ? COLORS.success : status === "active" ? color : COLORS.secondary;
        return (
          <Box key={step.label}>
            <Text color={COLORS.secondary}>{`  ${branch} `}</Text>
            <Text color={sc}>{icon}</Text>
            <Text color={sc} dimColor={status === "pending"}>{` ${step.label}`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Activity feed (lightweight, no heavy border) ──────────────────

function entryTag(entry: ActivityEntry): string {
  if (entry.tag) return entry.tag;
  switch (entry.type) {
    case "agent.thinking":
    case "agent.request": return "THINK";
    case "agent.chat": return "CHAT";
    case "agent.delta": return "│";
    case "agent.complete": return "DONE";
    case "agent.stopped": return "STOP";
    case "run.started": return "RUN";
    case "run.completed": return "DONE";
    case "run.failed": return "FAIL";
    case "tool.started": return "RUN";
    case "tool.completed": return "PASS";
    case "tool.failed": return "FAIL";
    case "tool.cancelled": return "STOP";
    case "tool.timeout": return "WARN";
    case "tool.stdout": return "│";
    case "tool.stderr": return "│";
    case "approval.required": return "APPROVAL";
    case "approval.granted": return "PASS";
    case "approval.denied": return "FAIL";
    case "credential.resolving": return "ROUTE";
    case "credential.ready": return "PASS";
    case "credential.denied": return "FAIL";
    case "model.changed": return "ROUTE";
    case "error": return "ERROR";
    case "info": return "INFO";
    case "help": return "INFO";
    case "mode": return "INFO";
    default: return "·";
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function ActivityFeed({ entries, maxEntries }: { entries: ActivityEntry[]; maxEntries: number }): React.ReactElement {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const msgMax = Math.max(20, termWidth - 20 - 2);

  // Collapse consecutive stream deltas — only show the latest
  const visible: ActivityEntry[] = [];
  const raw = entries.slice(-maxEntries * 2);
  for (const entry of raw) {
    const isStream = entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta";
    if (isStream && visible.length > 0) {
      const last = visible[visible.length - 1];
      const lastIsStream = last.type === "tool.stdout" || last.type === "tool.stderr" || last.type === "agent.delta";
      if (lastIsStream) {
        visible[visible.length - 1] = entry;
        continue;
      }
    }
    visible.push(entry);
  }
  const finalVisible = visible.slice(-maxEntries);

  return (
    <Box flexDirection="column">
      <Text color={COLORS.secondary} bold>ACTIVITY</Text>
      {finalVisible.length === 0 ? (
        <Text dimColor>{"  ·"}</Text>
      ) : (
        finalVisible.map((entry) => {
          const tag = entryTag(entry);
          const c = activityColor(tag);
          const time = formatTime(entry.ts);
          const isStream = entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta";
          const msg = truncate(entry.text, msgMax);
          return (
            <Box key={entry.id}>
              <Text dimColor>{`  ${time}  `}</Text>
              <Text color={c} bold={!isStream}>{tag.padEnd(8)}</Text>
              <Text color={c} dimColor={isStream || entry.type === "info"}>{` ${msg}`}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

// ─── Terminal — last command + result ──────────────────────────────

function TerminalSection({ entries }: { entries: ActivityEntry[] }): React.ReactElement | null {
  // Find the last tool.started (RUN) and its matching result (PASS/FAIL)
  let lastRun: ActivityEntry | null = null;
  let lastResult: ActivityEntry | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!lastResult && (e.type === "tool.completed" || e.type === "tool.failed")) {
      lastResult = e;
    }
    if (!lastRun && e.type === "tool.started") {
      lastRun = e;
      break;
    }
  }
  if (!lastRun && !lastResult) return null;

  const runText = lastRun ? lastRun.text : "—";
  const resultColor = lastResult
    ? (lastResult.type === "tool.completed" ? COLORS.success : COLORS.error)
    : COLORS.working;
  const resultIcon = lastResult
    ? (lastResult.type === "tool.completed" ? "✓" : "✗")
    : "●";
  const resultText = lastResult ? lastResult.text : "running…";

  return (
    <Box flexDirection="column">
      <Text color={COLORS.secondary} bold>TERMINAL</Text>
      <Text dimColor>{`  > `}</Text>
      <Text color={COLORS.text}>{runText}</Text>
      <Text color={resultColor}>{`    ${resultIcon} ${truncate(resultText, 60)}`}</Text>
    </Box>
  );
}

// ─── WorkingView composition ───────────────────────────────────────

export interface WorkingViewProps {
  holoState: HoloState;
  mission: string | null;
  missionState: MissionState | null;
  activityLog: ActivityEntry[];
  /** Terminal rows — used to budget how many activity lines to show */
  rows: number;
}

export function WorkingView({ holoState, mission, missionState, activityLog, rows }: WorkingViewProps): React.ReactElement {
  // Budget activity lines based on available rows.
  // Reserved: request(2) + thinking(9) + terminal(4) + prompt(2) + status(2) ≈ 19
  const activityMax = Math.max(3, Math.min(12, rows - 20));

  const requestText = mission ?? missionState?.text ?? null;
  const isComplete = holoState === "COMPLETE";
  const isFailed = holoState === "FAILED" || holoState === "CANCELLED" || holoState === "TIMEOUT";

  return (
    <Box flexDirection="column">
      {/* Request — what the user asked */}
      {requestText && (
        <Box flexDirection="column" marginBottom={0}>
          <Text color={isComplete ? COLORS.success : isFailed ? COLORS.error : COLORS.text}>
            {requestText}
          </Text>
        </Box>
      )}

      {/* Thinking tree */}
      <ThinkingTree state={holoState} />

      {/* Activity feed */}
      <Box marginTop={0}>
        <ActivityFeed entries={activityLog} maxEntries={activityMax} />
      </Box>

      {/* Terminal — last command + result */}
      <Box marginTop={0}>
        <TerminalSection entries={activityLog} />
      </Box>

      {/* Completion summary (only on COMPLETE/FAILED with mission data) */}
      {(isComplete || isFailed) && missionState && (missionState.filesTouched.length > 0 || missionState.testResults || missionState.runtimeProven !== null) && (
        <Box flexDirection="column" marginTop={0}>
          {missionState.filesTouched.length > 0 && (
            <Text dimColor>{`  ${missionState.filesTouched.length} file${missionState.filesTouched.length !== 1 ? "s" : ""} touched`}</Text>
          )}
          {missionState.testResults && (
            <Text color={missionState.testResults.failed === 0 ? COLORS.success : COLORS.error}>
              {`  ${missionState.testResults.passed}/${missionState.testResults.total} tests passed`}
            </Text>
          )}
          {missionState.runtimeProven !== null && (
            <Text color={missionState.runtimeProven ? COLORS.success : COLORS.error}>
              {`  Runtime ${missionState.runtimeProven ? "PROVEN" : "NOT PROVEN"}`}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
