/**
 * ShellTranscript — the minimal shell's transcript area.
 *
 * The exact region the Welcome occupied becomes this. Contents:
 *   1. Chat messages (user ❯ / assistant ⚡, unbordered — the ONE
 *      place the assistant body renders).
 *   2. A compact semantic activity feed (last few events) using the
 *      tiny vocabulary: → working ✓ success ! warning × failed ◆ decision.
 *   3. The DONE summary block after a mission completes.
 *
 * No borders, no headers, no jumping. Bounded by maxMessages so tall
 * terminals scroll naturally and short ones truncate.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../colors.js";
import { ChatMessageView } from "../chat-transcript.js";
import type { ActivityEntry, ChatMessage, MissionState, ActivitySemantic } from "../cockpit-store.js";
import { ChangeSummary, VerificationSummary } from "./summary.js";

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

export interface TranscriptAreaProps {
  messages: ChatMessage[];
  activityLog: ActivityEntry[];
  maxMessages?: number;
  maxActivity?: number;
  mission: MissionState | null;
  gitModified: number;
  gitUntracked: number;
}

export function TranscriptArea({
  messages,
  activityLog,
  maxMessages = 5,
  maxActivity = 4,
  mission,
  gitModified,
  gitUntracked,
}: TranscriptAreaProps): React.ReactElement | null {
  const visible = messages.slice(-maxMessages);
  if (visible.length === 0) return null;

  const events = visibleEvents(activityLog, maxActivity);
  const terminalMission = mission && (mission.state === "COMPLETE" || mission.state === "FAILED" || mission.state === "CANCELLED" || mission.state === "TIMEOUT");

  return (
    <Box flexDirection="column" marginBottom={0}>
      {visible.map((msg) => (
        <ChatMessageView key={msg.id} msg={msg} />
      ))}

      {/* DONE summary after a completed mission */}
      {terminalMission && mission && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={mission.state === "COMPLETE" ? COLORS.success : COLORS.error}>DONE</Text>
          <ChangeSummary mission={mission} gitModified={gitModified} gitUntracked={gitUntracked} />
          <VerificationSummary mission={mission} />
        </Box>
      )}

      {/* Compact semantic feed — the tiny vocabulary */}
      {events.length > 0 && (
        <Box flexDirection="column" marginTop={events.length > 0 ? 1 : 0}>
          {events.map((entry) => {
            const sem = semanticOf(entry);
            const { glyph, color } = SEMANTIC_GLYPH[sem];
            const isStreamLine = isStream(entry);
            return (
              <Box key={entry.id}>
                <Text color={isStreamLine ? COLORS.secondary : color} bold={!isStreamLine}>
                  {glyph} {truncate(entry.text, 96)}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
