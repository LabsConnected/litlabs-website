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
import type { WorkstreamSnapshot } from "../workstream-store.js";
import type { ExecutionTarget } from "../../lib/execution-target.js";
import { MissionResultBlock } from "./summary.js";
import { SummaryBlock } from "../observability.js";
import { ActivityStream, visibleEvents as pickVisibleEvents, wrapText } from "../activity-stream.js";
import {
  projectSummaryBlock,
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

  const events = pickVisibleEvents(activityLog, maxActivity);
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
  /** Live-mode semantic events — rendered as the compact ActivityStream. */
  events: ActivityEntry[];
  /** Viewport slice (start/end indices). */
  viewport: ViewportResult;
  /** Content width (reading measure). */
  contentWidth: number;
  mission: MissionState | null;
  gitModified: number;
  gitUntracked: number;
  /** Structured per-tool progress — retained for call-site compatibility. */
  toolProgress: ToolProgressSnapshot | null;
  /** Ctrl+O — expand every ActivityStream row that has a fullText payload. */
  toolDetails?: boolean;
  /** Current agent lifecycle phase — retained for call-site compatibility. */
  holoState: string;
  /** Chat-lane processing flag — retained for call-site compatibility. */
  isProcessing: boolean;
  /** Where the MODEL provider executes — retained for call-site compatibility. */
  executionTarget: ExecutionTarget;
  /** Canonical mission projection — retained for call-site compatibility. */
  canonicalMission: CanonicalMissionProjection | null;
  /** Live workstream snapshot — retained for call-site compatibility. */
  workstream: WorkstreamSnapshot | null;
}

export function TranscriptArea({
  messages,
  events,
  viewport,
  contentWidth,
  mission,
  gitModified,
  gitUntracked,
  toolDetails = false,
}: TranscriptAreaProps): React.ReactElement | null {
  if (messages.length === 0 || viewport.start >= viewport.end) return null;

  const visible = messages.slice(viewport.start, viewport.end);
  const terminalMission = mission
    && (mission.state === "COMPLETE" || mission.state === "FAILED"
      || mission.state === "CANCELLED" || mission.state === "TIMEOUT");

  const scrolled = !viewport.atBottom || viewport.hasAbove;
  const compact = contentWidth < 60;

  const summaryProps = viewport.atBottom ? projectSummaryBlock(mission) : null;

  return (
    <Box flexDirection="column">
      {visible.map((msg, idx) => (
        <Box key={msg.id} flexDirection="column" marginTop={idx === 0 ? 0 : 1}>
          <ChatMessageView msg={msg} width={contentWidth} />
        </Box>
      ))}

      {/* Live operator activity stream — real tool/runtime events only.
       *  Replaces the duplicated ThinkingBlock/ToolResultBlocks/
       *  MissionProgressBlock/WorkstreamView status surfaces. Live mode only. */}
      {viewport.atBottom && events.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <ActivityStream
            entries={events}
            maxEntries={4}
            width={contentWidth}
            details={toolDetails}
            compact={compact}
          />
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
 * The feed component renders:
 *   - non-compact: top border + ACTIVITY header + visible rows + bottom border
 *   - compact: visible rows only (no border/header)
 * When details is true, each row with a fullText payload expands by up
 * to DETAIL_MAX_LINES additional rows.
 *
 * The marginTop(1) above the feed is added by the caller
 * (estimateExtraContentHeight), not here.
 */
export function estimateActivityFeedHeight(
  events: ActivityEntry[],
  max = 4,
  details = false,
  width = 80,
): number {
  const visible = pickVisibleEvents(events, max);
  if (visible.length === 0) return 0;
  const compact = width < 60;
  const msgMax = Math.max(10, width - (compact ? 22 : 26));
  const borderRows = 0; // border removed — compact chrome
  const headerRows = compact ? 0 : 1;
  let rows = borderRows + headerRows + visible.length;
  if (details) {
    for (const entry of visible) {
      if (entry.fullText && entry.fullText.length > entry.text.length) {
        rows += Math.min(8, wrapText(entry.fullText, msgMax).length);
      }
    }
  }
  return rows;
}

/**
 * Total extra content height in live mode: the compact activity feed
 * plus the canonical MissionResultBlock and SummaryBlock. Each section has
 * marginTop(1) when present.
 *
 * The previous ThinkingBlock/ToolResultBlocks/MissionProgressBlock/WorkstreamView
 * status surfaces have been replaced by the live ActivityStream, so the
 * height budget now mirrors exactly what the transcript renders.
 *
 * `toolProgress`, `holoState`, `isProcessing`, `canonicalMission`,
 * `executionTarget`, and `workstream` remain in the signature for
 * call-site compatibility but are intentionally unused.
 *
 * Pure — used by the shell to compute the viewport budget accurately so
 * the fixed-height content region never overflows (the 100×30 collision
 * bug).
 */
export function estimateExtraContentHeight(
  _toolProgress: ToolProgressSnapshot | null,
  mission: MissionState | null,
  events: ActivityEntry[],
  toolDetails = false,
  _holoState = "IDLE",
  _isProcessing = false,
  _canonicalMission: CanonicalMissionProjection | null = null,
  _executionTarget: ExecutionTarget = "local",
  columns = 80,
  _workstream: WorkstreamSnapshot | null = null,
): number {
  let h = 0;

  // Live operator activity stream
  const feedH = estimateActivityFeedHeight(events, 4, toolDetails, columns);
  if (feedH > 0) h += feedH + 1; // marginTop(1)

  // MissionResultBlock (canonical terminal proof — kept)
  const resultH = estimateResultBlockHeight(mission);
  if (resultH > 0) h += resultH + 1; // marginTop(1)

  // SummaryBlock (terminal plain-English conclusion — kept)
  const summary = projectSummaryBlock(mission);
  const sh = estimateSummaryHeight(summary);
  if (sh > 0) h += sh + 1; // marginTop(1)

  return h;
}
