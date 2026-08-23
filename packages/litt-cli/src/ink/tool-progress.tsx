/**
 * ToolProgress — structured per-tool execution view for the shell.
 *
 * Renders during mission execution to fill the main content area with
 * live, friendly per-tool blocks instead of an empty streaming
 * placeholder. This is the "feel alive" surface:
 *
 *   → Inspecting workspace
 *   ✓ Package inspection complete
 *
 *   → Type checking
 *   ✓ 0 errors
 *
 *   → Running tests
 *   ◉ Running…
 *   ✓ 926 passed · 4 skipped
 *
 *   → Production build
 *   ◉ Building…
 *
 *   ✓ Scan complete
 *
 * Design rules:
 *   - One block per tool: label line + status line.
 *   - Running tools show ◉ with the latest chunk (or "Running…").
 *   - Completed tools show ✓ with the concise summary.
 *   - Failed tools show × with the error summary.
 *   - The mission terminal line (✓ Scan complete / × Scan failed) appears
 *     when the mission reaches a terminal state.
 *   - Raw stdout is NEVER dumped — only the concise lastChunk/summary.
 *   - Compact: blocks are separated by a blank line, no borders.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { ToolProgressSnapshot, ToolProgressEntry } from "./tool-progress-store.js";

const GLYPH_RUNNING = "◉";
const GLYPH_SUCCESS = "✓";
const GLYPH_FAILED = "×";
const GLYPH_CANCELLED = "○";
const GLYPH_TIMEOUT = "⏱";

function statusGlyph(entry: ToolProgressEntry): { glyph: string; color: string } {
  switch (entry.status) {
    case "running":
      return { glyph: GLYPH_RUNNING, color: COLORS.working };
    case "completed":
      return { glyph: GLYPH_SUCCESS, color: COLORS.success };
    case "failed":
      return { glyph: GLYPH_FAILED, color: COLORS.error };
    case "cancelled":
      return { glyph: GLYPH_CANCELLED, color: COLORS.warning };
    case "timeout":
      return { glyph: GLYPH_TIMEOUT, color: COLORS.warning };
  }
}

function ToolBlock({ entry }: { entry: ToolProgressEntry }): React.ReactElement {
  const { glyph, color } = statusGlyph(entry);
  const isRunning = entry.status === "running";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold>{glyph} </Text>
        <Text color={isRunning ? COLORS.working : COLORS.text} bold={isRunning}>
          {entry.label}
        </Text>
      </Box>
      {isRunning ? (
        <Text dimColor>  {entry.lastChunk ? entry.lastChunk : "Running…"}</Text>
      ) : (
        entry.summary && (
          <Text color={entry.status === "failed" ? COLORS.error : COLORS.secondaryDim}>
            {"  "}{entry.summary}{entry.durationMs != null ? ` · ${(entry.durationMs / 1000).toFixed(1)}s` : ""}
          </Text>
        )
      )}
    </Box>
  );
}

export interface ToolProgressProps {
  progress: ToolProgressSnapshot;
  /** Content width for truncation (defaults to a safe measure). */
  width?: number;
}

export function ToolProgress({ progress, width = 72 }: ToolProgressProps): React.ReactElement | null {
  if (progress.entries.length === 0 && !progress.missionActive) return null;

  const missionDone = progress.missionStatus === "completed";
  const missionFailed = progress.missionStatus === "failed";

  // Only show the mission terminal line when the mission is done AND
  // there are tool entries (otherwise it's a bare "complete" with no work).
  const showMissionLine = (missionDone || missionFailed) && progress.entries.length > 0;

  return (
    <Box flexDirection="column">
      {progress.entries.map((entry, idx) => (
        <Box key={entry.id} flexDirection="column" marginTop={idx === 0 ? 0 : 1}>
          <ToolBlock entry={entry} />
        </Box>
      ))}
      {showMissionLine && (
        <Box marginTop={1}>
          <Text color={missionDone ? COLORS.success : COLORS.error} bold>
            {missionDone ? `${GLYPH_SUCCESS} ` : `${GLYPH_FAILED} `}
            {missionDone ? "Scan complete" : "Scan failed"}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Estimated rendered height of the tool progress view at a given width.
 * Pure — used by the shell to fit the progress view into the content region.
 * Each tool block is 2 lines (label + status), plus 1 blank line between
 * blocks, plus 1 line for the mission terminal line (if shown).
 */
export function estimateToolProgressHeight(progress: ToolProgressSnapshot): number {
  if (progress.entries.length === 0 && !progress.missionActive) return 0;
  const blocks = progress.entries.length;
  const separators = Math.max(0, blocks - 1);
  const missionLine = (progress.missionStatus === "completed" || progress.missionStatus === "failed") && blocks > 0 ? 2 : 0; // marginTop(1) + line
  return blocks * 2 + separators + missionLine;
}
