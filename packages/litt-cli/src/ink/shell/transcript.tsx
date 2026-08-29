/**
 * ShellTranscript — the minimal shell's transcript area.
 *
 * The exact region the Welcome occupied becomes this. Contents:
 *   1. Chat messages (You / LiTT, unbordered — the ONE place the
 *      assistant body renders).
 *   2. A compact semantic activity feed (last few events) using the
 *      tiny vocabulary: → working ✓ success ! warning × failed ◆ decision.
 *      Events are INDENTED beneath LiTT output and rendered dim — the
 *      conversation is the hero, the runtime feed is subordinate.
 *   3. The DONE/FAILED result block after a mission terminates.
 *
 * VIEWPORT MODEL (dogfood P0): the LOGICAL transcript is never mutated
 * by rendering. The shell computes a viewport slice (scroll-model.ts)
 * and renders only that slice; the composer/status stay fixed. Events
 * and the result block are live-mode-only (they belong to the newest
 * turn); scrolled mode shows a scroll indicator instead.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../colors.js";
import { ChatMessageView } from "../chat-transcript.js";
import { layoutTranscript, computeViewport, SCROLL_INDICATOR_ROWS, type ViewportResult } from "../scroll-model.js";
import type { ActivityEntry, ChatMessage, MissionState, ActivitySemantic, CanonicalMissionProjection } from "../cockpit-store.js";
import type { ToolProgressSnapshot } from "../tool-progress-store.js";
import type { ExecutionTarget } from "../../lib/execution-target.js";
import { MissionResultBlock } from "./summary.js";
import { ThinkingBlock, ToolResultBlock, MissionProgressBlock, SummaryBlock } from "../observability.js";
import {
  projectThinkingBlock,
  projectToolResultBlocks,
  projectMissionProgressBlock,
  projectSummaryBlock,
  estimateThinkingHeight,
  estimateToolResultsHeight,
  estimateMissionProgressHeight,
  estimateSummaryHeight,
} from "../observability-project.js";

/** Tiny-vocabulary glyphs. */
export const SEMANTIC_GLYPH: Record<ActivitySemantic, { glyph: string; color: string }> = {
  working: { glyph: "→", color: COLORS.working },
  success: { glyph: "✓", color: COLORS.success },
  warning: { glyph: "!", color: COLORS.warning },
  failed: { glyph: "×", color: COLORS.error },
  decision: { glyph: "◆", color: COLORS.brand },
};

/** Derive the semantic class from the entry when not explicitly set. */
export function semanticOf(entry: ActivityEntry): ActivitySemantic {
  if (entry.semantic) return entry.semantic;
  // Plan-mode denials are DECISIONS, not failures: the policy did its
  // job (a mutation was blocked on purpose). Surface as ◆ — never a
  // scary red error. "Switch to Act" guidance lives in the message.
  if (/^PLAN mode rejects/i.test(entry.text)) return "decision";
  switch (entry.type) {
    case "run.completed":
    case "tool.completed":
    case "mission.step_passed":
    case "mission.completed":
    case "verification.passed":
    case "agent.complete":
    case "approval.granted":
      return "success";
    case "run.failed":
    case "tool.failed":
    case "mission.step_failed":
    case "mission.failed":
    case "verification.failed":
    case "agent.stopped":
    case "approval.denied":
    case "error":
      return "failed";
    case "tool.timeout":
    case "approval.required":
      return "warning";
    case "model.changed":
    case "mode":
      return "decision";
    case "tool.started":
    case "mission.step_started":
    case "agent.request":
    case "run.started":
      return "working";
    default:
      return "working";
  }
}

function isStream(entry: ActivityEntry): boolean {
  return entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta";
}

/** Collapse consecutive stream lines, keep the latest, then tail. */
function visibleEvents(entries: ActivityEntry[], max: number): ActivityEntry[] {
  const collapsed: ActivityEntry[] = [];
  for (const entry of entries.slice(-max * 3)) {
    if (isStream(entry) && collapsed.length > 0 && isStream(collapsed[collapsed.length - 1])) {
      collapsed[collapsed.length - 1] = entry;
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed.slice(-max);
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return single.length <= max ? single : single.slice(0, max - 1) + "…";
}

export interface FitResult {
  messages: ChatMessage[];
  events: ActivityEntry[];
  /** True when everything fits the region (used to enable the fixed height). */
  fits: boolean;
}

/**
 * Live-mode viewport fit — the largest suffix of messages that fits the
 * region, plus any events that fit beneath. Pure + back-compat with the
 * pre-scroll shell. The scrolled shell uses computeViewport() directly.
 */
export function fitContent(
  messages: ChatMessage[],
  activityLog: ActivityEntry[],
  regionHeight: number,
  width: number,
  maxActivity = 4,
): FitResult {
  if (messages.length === 0) {
    return { messages: [], events: [], fits: true };
  }
  const layout = layoutTranscript(messages, width);
  const vp = computeViewport(messages, layout, regionHeight, null, 0);
  const picked = messages.slice(vp.start, vp.end);
  if (!vp.fits) {
    return { messages: picked, events: [], fits: false };
  }

  const events = visibleEvents(activityLog, maxActivity);
  const used = layout.prefix[vp.end] - layout.prefix[vp.start];
  const remaining = Math.max(4, regionHeight) - used;
  let eventCount = 0;
  if (remaining >= 2 && events.length > 0) {
    eventCount = Math.min(events.length, remaining - 1);
  }
  return { messages: picked, events: eventCount > 0 ? events.slice(-eventCount) : [], fits: true };
}

export interface TranscriptAreaProps {
  /** All logical messages (the shell slices the viewport). */
  messages: ChatMessage[];
  /** Live-mode semantic events (kept for the feed helpers / /activity; the
   *  raw feed is no longer rendered in the transcript — the observability
   *  blocks replace it). */
  events: ActivityEntry[];
  /** Viewport slice (start/end indices). */
  viewport: ViewportResult;
  /** Content width (reading measure). */
  contentWidth: number;
  mission: MissionState | null;
  gitModified: number;
  gitUntracked: number;
  /** Structured per-tool progress — mapped into ToolResultBlocks (live mode
   *  only). Each entry becomes a grouped execution card with the LOCAL/REMOTE
   *  locus preserved. */
  toolProgress: ToolProgressSnapshot | null;
  /** Ctrl+O — show result summaries for collapsed successful runs. */
  toolDetails?: boolean;
  /** Current agent lifecycle phase — drives the ThinkingBlock header. */
  holoState: string;
  /** Chat-lane processing flag — surfaces a THINKING phase when no holo
   *  phase is active. */
  isProcessing: boolean;
  /** Where the MODEL provider executes — preserved as the locus on every
   *  execution block (LOCAL/REMOTE). */
  executionTarget: ExecutionTarget;
  /** Canonical mission projection — real mission steps drive the
   *  MissionProgressBlock. null when no mission is active. */
  canonicalMission: CanonicalMissionProjection | null;
}

export function TranscriptArea({
  messages,
  events,
  viewport,
  contentWidth,
  mission,
  gitModified,
  gitUntracked,
  toolProgress,
  toolDetails = false,
  holoState,
  isProcessing,
  executionTarget,
  canonicalMission,
}: TranscriptAreaProps): React.ReactElement | null {
  // `events` is no longer rendered directly (the raw semantic feed is
  // replaced by the structured observability blocks). It remains in the
  // props for the feed helpers / /activity / fitContent compatibility.
  void events;
  void toolDetails;

  if (messages.length === 0 || viewport.start >= viewport.end) return null;

  const visible = messages.slice(viewport.start, viewport.end);
  const terminalMission = mission
    && (mission.state === "COMPLETE" || mission.state === "FAILED"
      || mission.state === "CANCELLED" || mission.state === "TIMEOUT");

  const scrolled = !viewport.atBottom || viewport.hasAbove;

  // ── Observability projections (pure; presentation layer only) ──────
  // These map real runtime state into the four structured blocks. Runtime
  // semantics are unchanged — every label/status/locus is derived from the
  // live tool progress, canonical mission steps, or terminal mission
  // evidence. LOCAL/REMOTE truth is preserved on every execution block.
  const thinkingProps = viewport.atBottom
    ? projectThinkingBlock(holoState, isProcessing, toolProgress ?? EMPTY_TOOL_PROGRESS, canonicalMission, executionTarget)
    : null;

  const toolBlocks = viewport.atBottom && toolProgress && toolProgress.entries.length > 0
    ? projectToolResultBlocks(toolProgress, executionTarget)
    : [];

  const missionElapsedMs = mission && mission.startedAt != null && mission.endedAt != null
    ? mission.endedAt - mission.startedAt
    : null;
  const missionProgressProps = viewport.atBottom
    ? projectMissionProgressBlock(canonicalMission, mission, executionTarget, missionElapsedMs)
    : null;

  const summaryProps = viewport.atBottom ? projectSummaryBlock(mission) : null;

  return (
    <Box flexDirection="column">
      {visible.map((msg, idx) => (
        <Box key={msg.id} flexDirection="column" marginTop={idx === 0 ? 0 : 1}>
          <ChatMessageView msg={msg} width={contentWidth} />
        </Box>
      ))}

      {/* ThinkingBlock — the active reasoning/execution phase with ordered
       *  micro-steps. Replaces the implicit "LiTT is working" + scattered
       *  activity noise with one structured "watch LiTT work" header. Live
       *  mode only. */}
      {viewport.atBottom && thinkingProps && (
        <Box flexDirection="column" marginTop={1}>
          <ThinkingBlock {...thinkingProps} width={contentWidth} />
        </Box>
      )}

      {/* ToolResultBlocks — one grouped execution card per tool, each
       *  carrying the LOCAL/REMOTE locus. Replaces the raw per-tool noise
       *  with structured, bordered result blocks. Live mode only. */}
      {viewport.atBottom && toolBlocks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {toolBlocks.map((block, i) => (
            <Box key={i} marginTop={i === 0 ? 0 : 1}>
              <ToolResultBlock {...block} width={contentWidth} />
            </Box>
          ))}
        </Box>
      )}

      {/* MissionProgressBlock — real mission step progress from the
       *  canonical mission projection. Live mode only. */}
      {viewport.atBottom && missionProgressProps && (
        <Box flexDirection="column" marginTop={1}>
          <MissionProgressBlock {...missionProgressProps} width={contentWidth} />
        </Box>
      )}

      {/* DONE/FAILED result block — the canonical honest proof block.
       *  Live mode only (belongs to the newest turn). Kept as the
       *  structured terminal evidence; the SummaryBlock below adds the
       *  plain-English conclusion. */}
      {viewport.atBottom && terminalMission && mission && (
        <Box marginTop={1}>
          <MissionResultBlock
            mission={mission}
            gitModified={gitModified}
            gitUntracked={gitUntracked}
          />
        </Box>
      )}

      {/* SummaryBlock — LiTT's plain-English conclusion at terminal state.
       *  Derived honestly from mission evidence (never invented). Live mode
       *  only. */}
      {viewport.atBottom && summaryProps && (
        <Box marginTop={1}>
          <SummaryBlock {...summaryProps} width={contentWidth} />
        </Box>
      )}

      {/* Scroll indicator — scrolled mode only */}
      {scrolled && (
        <Box flexDirection="column" marginTop={1}>
          {viewport.hasAbove && viewport.atBottom && (
            <Text dimColor>{"  ↑ older messages · Ctrl+End latest"}</Text>
          )}
          {viewport.hasAbove && !viewport.atBottom && (
            <Text dimColor>
              {`  ↑ older messages · ↓ ${viewport.belowCount} new · Ctrl+End latest`}
            </Text>
          )}
          {!viewport.hasAbove && !viewport.atBottom && (
            <Text dimColor>
              {`  ↓ ${viewport.belowCount} new · Ctrl+End latest`}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/** A zero-entry tool progress snapshot for the idle/no-progress case. */
const EMPTY_TOOL_PROGRESS: ToolProgressSnapshot = {
  entries: [],
  missionActive: false,
  missionStatus: null,
  hasRunning: false,
};

// Re-export for the shell and tests.
export { layoutTranscript, computeViewport, SCROLL_INDICATOR_ROWS };

/**
 * Estimate the rendered height of the MissionResultBlock.
 * Pure — used by the shell to reserve rows for the result block so the
 * fixed-height content region doesn't overflow (causing line collisions).
 *
 * The result block renders:
 *   - 1 header line (DONE/FAILED/CANCELLED/TIMEOUT)
 *   - 1 line per proof line (verification, tools used, delta, tests, typecheck, build)
 *   - 3 rows for failed-state action hints (marginTop + /diff + /verify)
 */
export function estimateResultBlockHeight(mission: MissionState | null): number {
  if (!mission) return 0;
  const isTerminal = mission.state === "COMPLETE" || mission.state === "FAILED"
    || mission.state === "CANCELLED" || mission.state === "TIMEOUT";
  if (!isTerminal) return 0;

  let rows = 1; // header

  // Verification line (rendered for both read-only and mutating missions)
  if (mission.runtimeProven !== null) rows++;

  // Read-only line ("N tools used")
  if (mission.readOnly && mission.toolsUsed.length > 0) rows++;

  // Mission delta line (mutating missions with actual file changes)
  if (!mission.readOnly && mission.missionDeltaFiles && mission.missionDeltaFiles.length > 0) rows++;

  // Test results line
  if (mission.testResults) rows++;

  // Typecheck line
  if (mission.typecheckPassed !== null) rows++;

  // Build line
  if (mission.buildPassed !== null) rows++;

  // Failed-state next actions: marginTop(1) + /diff + /verify = 3 rows
  const isSuccess = mission.state === "COMPLETE";
  if (!isSuccess && mission.state !== "CANCELLED" && mission.state !== "TIMEOUT") {
    rows += 3;
  }

  return rows;
}

/**
 * Estimate the rendered height of the compact activity feed.
 * Pure — used by the shell to reserve rows for the feed.
 *
 * The feed renders with marginTop(1) + one line per visible event.
 */
export function estimateActivityFeedHeight(events: ActivityEntry[], max = 4): number {
  const visible = visibleEvents(events, max);
  if (visible.length === 0) return 0;
  return 1 + visible.length; // marginTop(1) + event lines
}

/**
 * Total extra content height in live mode: the observability blocks
 * (ThinkingBlock + ToolResultBlocks + MissionProgressBlock) plus the
 * canonical MissionResultBlock and SummaryBlock. Each section has
 * marginTop(1) when present.
 *
 * The raw semantic activity feed is no longer rendered in the transcript
 * (the observability blocks replace it), so its height is no longer
 * reserved here. `events` and `toolDetails` remain in the signature for
 * call-site compatibility and are intentionally unused.
 *
 * Pure — used by the shell to compute the viewport budget accurately so
 * the fixed-height content region never overflows (the 100×30 collision
 * bug). The new observability inputs (holoState, isProcessing,
 * canonicalMission, executionTarget, columns) default to values that
 * zero out their sections, so callers that don't pass them get the
 * tool-result + result-block + summary estimate only.
 */
export function estimateExtraContentHeight(
  toolProgress: ToolProgressSnapshot | null,
  mission: MissionState | null,
  events: ActivityEntry[],
  toolDetails = false,
  // Observability inputs (defaults zero out their sections):
  holoState = "IDLE",
  isProcessing = false,
  canonicalMission: CanonicalMissionProjection | null = null,
  executionTarget: ExecutionTarget = "local",
  columns = 80,
): number {
  void events; // feed removed — blocks replace it
  void toolDetails; // ToolResultBlock always shows summaries (no collapse toggle)

  let h = 0;

  // ThinkingBlock (during active work)
  const thinking = projectThinkingBlock(
    holoState, isProcessing,
    toolProgress ?? EMPTY_TOOL_PROGRESS,
    canonicalMission, executionTarget,
  );
  const th = estimateThinkingHeight(thinking);
  if (th > 0) h += th + 1; // marginTop(1)

  // ToolResultBlocks (replaces ToolProgress)
  if (toolProgress && toolProgress.entries.length > 0) {
    const blocks = projectToolResultBlocks(toolProgress, executionTarget);
    h += estimateToolResultsHeight(blocks, columns) + 1; // marginTop(1)
  }

  // MissionProgressBlock
  const elapsedMs = mission && mission.startedAt != null && mission.endedAt != null
    ? mission.endedAt - mission.startedAt
    : null;
  const mp = projectMissionProgressBlock(canonicalMission, mission, executionTarget, elapsedMs);
  const mph = estimateMissionProgressHeight(mp);
  if (mph > 0) h += mph + 1; // marginTop(1)

  // MissionResultBlock (canonical terminal proof — kept)
  const resultH = estimateResultBlockHeight(mission);
  if (resultH > 0) h += resultH + 1; // marginTop(1)

  // SummaryBlock (terminal plain-English conclusion — new)
  const summary = projectSummaryBlock(mission);
  const sh = estimateSummaryHeight(summary);
  if (sh > 0) h += sh + 1; // marginTop(1)

  return h;
}
