/**
 * Observability projection — pure runtime-state → observability block props.
 *
 * This is the PRESENTATION-ONLY bridge between the live runtime flow and the
 * four observability blocks (ThinkingBlock, ToolResultBlock,
 * MissionProgressBlock, SummaryBlock). It maps real runtime events into
 * structured block props instead of dumping raw status/noise.
 *
 * Design rules:
 *   - PURE — no React, no side effects, no Date.now() in the projectors
 *     (elapsed time is computed by the caller and passed in). Fully testable
 *     in the CLI's `node` test env without a renderer.
 *   - Runtime semantics are NEVER changed — this only reads state and shapes
 *     it for rendering.
 *   - LOCAL/REMOTE truth is preserved in every execution block via the
 *     `executionLocus()` helper, derived from the canonical ExecutionTarget.
 *   - Nothing is invented — every label/status/summary is derived from real
 *     tool progress, canonical mission steps, or terminal mission evidence.
 *   - The canonical MissionStepStatus vocabulary
 *     (pending|working|verifying|passed|failed|blocked|skipped) is mapped onto
 *     the block's smaller status vocabularies honestly.
 */

import type { HoloState, MissionState, CanonicalMissionProjection } from "./cockpit-store.js";
import type { ToolProgressSnapshot, ToolProgressEntry, ToolStatus } from "./tool-progress-store.js";
import type { ExecutionTarget } from "../lib/execution-target.js";
import type {
  Locus,
  ThinkingBlockProps,
  ThinkingStep,
  ToolResultBlockProps,
  MissionProgressBlockProps,
  MissionStep,
  SummaryBlockProps,
} from "./observability.js";

// ─── Locus ──────────────────────────────────────────────────────────

/** Map the canonical ExecutionTarget onto the block's Locus vocabulary. */
export function executionLocus(target: ExecutionTarget): Locus {
  return target === "remote" ? "REMOTE" : "LOCAL";
}

// ─── Phase ──────────────────────────────────────────────────────────

const PHASE_LABELS: Partial<Record<HoloState, string>> = {
  UNDERSTANDING: "ANALYZING",
  PLANNING: "PLANNING",
  READING: "READING",
  EDITING: "EDITING",
  RUNNING: "EXECUTING",
  TESTING: "TESTING",
  VERIFYING: "VERIFYING",
  APPROVAL: "APPROVAL",
};

/** Human phase label for the ThinkingBlock header. */
export function phaseLabel(holoState: string, isProcessing: boolean): string {
  if (PHASE_LABELS[holoState as HoloState]) return PHASE_LABELS[holoState as HoloState]!;
  if (isProcessing) return "THINKING";
  return "IDLE";
}

/** True when LiTT is actively working (a live holo phase or chat processing). */
export function isActivePhase(holoState: string, isProcessing: boolean): boolean {
  return phaseLabel(holoState, isProcessing) !== "IDLE";
}

// ─── 1. ThinkingBlock ───────────────────────────────────────────────

const WORKING_HOLO_PHASES: ReadonlySet<string> = new Set([
  "UNDERSTANDING", "PLANNING", "READING", "EDITING", "RUNNING", "TESTING", "VERIFYING",
]);

/** Map a ToolStatus onto a ThinkingStep status (the "what's happening now" view). */
function toolStatusToThinking(status: ToolStatus): ThinkingStep["status"] {
  // The thinking view tracks PROGRESS, not success/failure — a terminal tool
  // is "done" regardless of outcome. The ToolResultBlock carries the
  // success/failure detail; the ThinkingBlock just shows the step advanced.
  if (status === "running") return "active";
  return "complete"; // completed | failed | cancelled | timeout
}

/**
 * Project the ThinkingBlock — the active reasoning/execution phase with
 * ordered micro-steps derived from real tool progress + canonical mission
 * steps.
 *
 * Steps are built honestly:
 *   1. When a mission is active: "project detected" + "execution target:
 *      LOCAL/REMOTE" (both complete — these are always true once a mission
 *      runs).
 *   2. Tool progress entries (last few) → complete/active steps.
 *   3. Pending canonical mission steps → pending steps.
 *   4. If nothing concrete yet, the phase itself is the active step.
 *
 * Returns null when LiTT is idle (nothing to show).
 */
export function projectThinkingBlock(
  holoState: string,
  isProcessing: boolean,
  toolProgress: ToolProgressSnapshot,
  canonicalMission: CanonicalMissionProjection | null,
  executionTarget: ExecutionTarget,
): ThinkingBlockProps | null {
  const phase = phaseLabel(holoState, isProcessing);
  if (phase === "IDLE") return null;

  const steps: ThinkingStep[] = [];
  const missionActive = toolProgress.missionActive || canonicalMission !== null;

  // Contextual anchor steps — only when a mission is actually running, so we
  // never fabricate "project detected" for a plain chat turn.
  if (missionActive) {
    steps.push({ label: "project detected", status: "complete" });
    steps.push({ label: `execution target: ${executionLocus(executionTarget)}`, status: "complete" });
  }

  // Tool progress → micro-steps (cap to the last 5 to stay compact).
  for (const entry of toolProgress.entries.slice(-5)) {
    steps.push({ label: entry.label, status: toolStatusToThinking(entry.status) });
  }

  // Pending canonical mission steps → pending steps (the plan ahead).
  if (canonicalMission) {
    for (const step of canonicalMission.steps) {
      if (step.status === "pending") {
        steps.push({ label: step.title, status: "pending" });
      }
    }
  }

  // If there's nothing concrete to show yet, surface the phase itself as the
  // active step so the block is never empty during active work.
  if (steps.length === 0) {
    steps.push({ label: phase.toLowerCase(), status: "active" });
  }

  return { phase, steps };
}

// ─── 2. ToolResultBlock ─────────────────────────────────────────────

/** Map a single ToolProgressEntry → ToolResultBlockProps (with locus). */
function toolEntryToBlock(entry: ToolProgressEntry, locus: Locus): ToolResultBlockProps {
  const running = entry.status === "running";
  // exitCode: null while running; 0 for completed; non-zero for any failure.
  const exitCode = running ? null : entry.status === "completed" ? 0 : 1;
  // Output: the concise summary (preferred) or the latest chunk.
  const output = entry.summary
    ? [entry.summary]
    : entry.lastChunk
      ? [entry.lastChunk]
      : undefined;
  return {
    locus,
    command: entry.label,
    exitCode,
    durationMs: entry.durationMs,
    output,
    running,
  };
}

/**
 * Project ToolResultBlocks — one grouped result block per tool entry, each
 * carrying the LOCAL/REMOTE locus. Replaces the raw per-tool noise with
 * structured, bordered execution cards.
 */
export function projectToolResultBlocks(
  toolProgress: ToolProgressSnapshot,
  executionTarget: ExecutionTarget,
): ToolResultBlockProps[] {
  const locus = executionLocus(executionTarget);
  return toolProgress.entries.map((entry) => toolEntryToBlock(entry, locus));
}

// ─── 3. MissionProgressBlock ────────────────────────────────────────

/** Map a canonical MissionStepStatus onto the block's MissionStep status. */
export function canonicalStepStatus(status: string): MissionStep["status"] {
  switch (status) {
    case "passed":
    case "skipped":
      return "complete";
    case "working":
    case "verifying":
      return "active";
    case "failed":
      return "failed";
    case "blocked":
    case "pending":
    default:
      return "pending";
  }
}

/**
 * Project the MissionProgressBlock — real mission step progress from the
 * canonical mission projection. Returns null when there are no canonical
 * steps to show.
 *
 * `elapsedMs` is passed in by the caller (the shell computes it from
 * missionState.startedAt/endedAt vs the current clock) so this stays pure.
 */
export function projectMissionProgressBlock(
  canonicalMission: CanonicalMissionProjection | null,
  missionState: MissionState | null,
  executionTarget: ExecutionTarget,
  elapsedMs: number | null,
): MissionProgressBlockProps | null {
  if (!canonicalMission || canonicalMission.steps.length === 0) return null;

  const locus = executionLocus(executionTarget);
  const steps: MissionStep[] = canonicalMission.steps.map((s) => ({
    label: s.title,
    status: canonicalStepStatus(s.status),
  }));

  // Title: the mission goal, uppercased and capped (the block header style).
  const title = canonicalMission.goal.length > 40
    ? canonicalMission.goal.slice(0, 39).toUpperCase() + "…"
    : canonicalMission.goal.toUpperCase();

  return { title, steps, elapsedMs, locus };
}

// ─── 4. SummaryBlock ────────────────────────────────────────────────

const TERMINAL_MISSION_STATES: ReadonlySet<string> = new Set([
  "COMPLETE", "FAILED", "CANCELLED", "TIMEOUT",
]);

/** True when the mission has reached a terminal state. */
export function isTerminalMission(missionState: MissionState | null): boolean {
  return missionState !== null && TERMINAL_MISSION_STATES.has(missionState.state);
}

/**
 * Derive an honest one-line conclusion from terminal mission evidence.
 * Nothing is invented — every clause comes from real mission state.
 */
export function missionSummaryText(m: MissionState): string {
  switch (m.state) {
    case "CANCELLED":
      return "Mission cancelled.";
    case "TIMEOUT":
      return "Mission timed out.";
    case "FAILED": {
      const parts: string[] = [];
      if (m.testResults && m.testResults.failed > 0) {
        parts.push(`${m.testResults.failed} test${m.testResults.failed !== 1 ? "s" : ""} still failing`);
      }
      if (m.typecheckPassed === false) parts.push("typecheck failing");
      if (m.buildPassed === false) parts.push("build failing");
      if (m.runtimeProven === false) parts.push("verification failed");
      return parts.length > 0 ? parts.join(". ") + "." : "Mission failed.";
    }
    case "COMPLETE":
    default: {
      const parts: string[] = [];
      if (m.runtimeProven) {
        parts.push(m.readOnly ? "inspection verified" : "verification passed");
      }
      if (m.testResults && m.testResults.failed === 0) {
        parts.push(`${m.testResults.passed} tests passed`);
      }
      if (m.typecheckPassed) parts.push("typecheck clean");
      if (m.buildPassed) parts.push("build clean");
      if (!m.readOnly && m.missionDeltaFiles && m.missionDeltaFiles.length > 0) {
        const n = m.missionDeltaFiles.length;
        parts.push(`${n} file${n !== 1 ? "s" : ""} changed`);
      }
      return parts.length > 0 ? parts.join(". ") + "." : "Mission complete.";
    }
  }
}

/**
 * Project the SummaryBlock — the plain-English conclusion at terminal state.
 * Returns null until the mission reaches a terminal state.
 */
export function projectSummaryBlock(missionState: MissionState | null): SummaryBlockProps | null {
  if (missionState === null) return null;
  if (!isTerminalMission(missionState)) return null;
  return {
    text: missionSummaryText(missionState),
    success: missionState.state === "COMPLETE",
  };
}

// ─── Height estimation ──────────────────────────────────────────────

/**
 * Estimated rendered height of the ThinkingBlock.
 * Pure — used by the shell to reserve rows so the fixed content region
 * doesn't overflow.
 *
 *   1 header line + 1 line per step.
 */
export function estimateThinkingHeight(props: ThinkingBlockProps | null): number {
  if (!props) return 0;
  return 1 + props.steps.length;
}

/**
 * Estimated rendered height of one ToolResultBlock at a given terminal width.
 *
 * Narrow (borderless): 2 lines (header + status) + up to 3 output lines.
 * Wide (bordered):     3 lines (header + divider + status) + up to 5 output
 *   lines. The border itself doesn't add rows in Ink (paddingX is horizontal).
 */
export function estimateToolResultHeight(props: ToolResultBlockProps, columns: number): number {
  const narrow = columns < 60;
  const maxOutput = narrow ? 3 : 5;
  const base = narrow ? 2 : 3;
  const outputLines = props.output ? Math.min(props.output.length, maxOutput) : 0;
  return base + outputLines;
}

/** Total estimated height of all ToolResultBlocks (no gaps between them). */
export function estimateToolResultsHeight(
  blocks: ToolResultBlockProps[],
  columns: number,
): number {
  return blocks.reduce((sum, b) => sum + estimateToolResultHeight(b, columns), 0);
}

/**
 * Estimated rendered height of the MissionProgressBlock.
 *
 *   1 header line + 1 line per step + 1 footer line (elapsed · locus).
 */
export function estimateMissionProgressHeight(props: MissionProgressBlockProps | null): number {
  if (!props) return 0;
  const footer = props.elapsedMs != null || props.locus ? 1 : 0;
  return 1 + props.steps.length + footer;
}

/** Estimated rendered height of the SummaryBlock: 2 lines (label + text). */
export function estimateSummaryHeight(props: SummaryBlockProps | null): number {
  if (!props) return 0;
  return 2;
}
