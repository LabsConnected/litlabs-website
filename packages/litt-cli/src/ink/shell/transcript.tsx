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
import type { ActivityEntry, ChatMessage, MissionState, ActivitySemantic } from "../cockpit-store.js";
import { MissionResultBlock } from "./summary.js";

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
  /** Live-mode semantic events (rendered only at the bottom). */
  events: ActivityEntry[];
  /** Viewport slice (start/end indices). */
  viewport: ViewportResult;
  /** Content width (reading measure). */
  contentWidth: number;
  mission: MissionState | null;
  gitModified: number;
  gitUntracked: number;
}

export function TranscriptArea({
  messages,
  events,
  viewport,
  contentWidth,
  mission,
  gitModified,
  gitUntracked,
}: TranscriptAreaProps): React.ReactElement | null {
  if (messages.length === 0 || viewport.start >= viewport.end) return null;

  const visible = messages.slice(viewport.start, viewport.end);
  const terminalMission = mission
    && (mission.state === "COMPLETE" || mission.state === "FAILED"
      || mission.state === "CANCELLED" || mission.state === "TIMEOUT");

  const scrolled = !viewport.atBottom || viewport.hasAbove;

  return (
    <Box flexDirection="column">
      {visible.map((msg, idx) => (
        <Box key={msg.id} flexDirection="column" marginTop={idx === 0 ? 0 : 1}>
          <ChatMessageView msg={msg} width={contentWidth} />
        </Box>
      ))}

      {/* DONE/FAILED result block — live mode only (belongs to the newest turn) */}
      {viewport.atBottom && terminalMission && mission && (
        <Box marginTop={1}>
          <MissionResultBlock
            mission={mission}
            gitModified={gitModified}
            gitUntracked={gitUntracked}
          />
        </Box>
      )}

      {/* Compact semantic feed — live mode only, indented + dim */}
      {viewport.atBottom && visibleEvents(events, 4).length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {visibleEvents(events, 4).map((entry) => {
            const sem = semanticOf(entry);
            const { glyph, color } = SEMANTIC_GLYPH[sem];
            const isStreamLine = isStream(entry);
            return (
              <Box key={entry.id}>
                <Text color={isStreamLine ? COLORS.secondaryDim : color} bold={!isStreamLine}>
                  {glyph}
                </Text>
                <Text dimColor> {truncate(entry.text, contentWidth - 4)}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Scroll indicator — scrolled mode only */}
      {scrolled && (
        <Box flexDirection="column" marginTop={1}>
          {viewport.hasAbove && (
            <Text dimColor>{"  ↑ Earlier messages"}</Text>
          )}
          {!viewport.atBottom && (
            <Text dimColor>
              {"  ↓ "}{viewport.belowCount} new · End to return live
            </Text>
          )}
          {viewport.atBottom && (
            <Text dimColor>{"  End to return live"}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// Re-export for the shell and tests.
export { layoutTranscript, computeViewport, SCROLL_INDICATOR_ROWS };
