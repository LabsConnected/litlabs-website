/**
 * ToolProgress — structured per-tool execution view for the shell.
 *
 * Renders during mission execution as ONE dense execution group instead
 * of noisy standalone transcript blocks:
 *
 *   ✓ Git status · 0.3s              ← collapsed success (1 line,
 *                                      duration secondary/dim)
 *   ✓ TypeScript · 22.7s
 *   ◆ Running tests                  ← active stays expanded
 *     pnpm vitest run --coverage…
 *   × bash discovery                 ← failures stay expanded
 *     denied by policy
 *
 * Design rules:
 *   - Successful runs collapse automatically to a single line.
 *   - Failed/cancelled runs remain expanded with their summary.
 *   - The active run remains expanded with its latest output chunk.
 *   - Ctrl+O (`details`) expands the summaries of collapsed successes.
 *   - Active glyph is the LiTT ◆ in purple — never a spinner.
 *   - Raw stdout is NEVER dumped — only the concise lastChunk/summary.
 *   - Duration is secondary (dim), never the dominant signal.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { ToolProgressSnapshot, ToolProgressEntry } from "./tool-progress-store.js";

const GLYPH_ACTIVE = "◆";
const GLYPH_SUCCESS = "✓";
const GLYPH_FAILED = "×";
const GLYPH_CANCELLED = "○";
const GLYPH_TIMEOUT = "⏱";

function statusGlyph(entry: ToolProgressEntry): { glyph: string; color: string } {
  switch (entry.status) {
    case "running":
      return { glyph: GLYPH_ACTIVE, color: COLORS.brand };
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

function ToolBlock({ entry, details }: { entry: ToolProgressEntry; details: boolean }): React.ReactElement {
  const { glyph, color } = statusGlyph(entry);
  const isRunning = entry.status === "running";
  const duration = entry.durationMs != null ? ` · ${(entry.durationMs / 1000).toFixed(1)}s` : "";

  if (isRunning) {
    // Active run — expanded: ◆ label + latest output chunk.
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={color} bold>{glyph} </Text>
          <Text color={COLORS.brand} bold>{entry.label}</Text>
        </Box>
        <Text dimColor>  {entry.lastChunk ? entry.lastChunk : "Running…"}</Text>
      </Box>
    );
  }

  if (entry.status === "completed" && !details) {
    // Collapsed success — ONE line, duration secondary/dim.
    return (
      <Box>
        <Text color={COLORS.success}>{glyph} </Text>
        <Text color={COLORS.text}>{entry.label}</Text>
        <Text dimColor>{duration}</Text>
      </Box>
    );
  }

  // Failed / cancelled / timed out stay expanded. Completed runs expand
  // to two lines when the operator toggles details (Ctrl+O).
  const failed = entry.status !== "completed";
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold={failed}>{glyph} </Text>
        <Text color={failed ? COLORS.text : COLORS.text} bold={failed}>{entry.label}</Text>
        <Text dimColor>{duration}</Text>
      </Box>
      {entry.summary && (
        <Text color={failed ? COLORS.error : COLORS.secondaryDim}>
          {"  "}{entry.summary}
        </Text>
      )}
    </Box>
  );
}

export interface ToolProgressProps {
  progress: ToolProgressSnapshot;
  /** Content width for truncation (defaults to a safe measure). */
  width?: number;
  /** Ctrl+O — expand result summaries of collapsed successful runs. */
  details?: boolean;
}

export function ToolProgress({ progress, width = 72, details = false }: ToolProgressProps): React.ReactElement | null {
  void width;
  if (progress.entries.length === 0 && !progress.missionActive) return null;

  const missionDone = progress.missionStatus === "completed";
  const missionFailed = progress.missionStatus === "failed";

  // Only show the mission terminal line when the mission is done AND
  // there are tool entries (otherwise it's a bare "complete" with no work).
  const showMissionLine = (missionDone || missionFailed) && progress.entries.length > 0;

  return (
    <Box flexDirection="column">
      {progress.entries.map((entry, idx) => (
        <Box key={entry.id} marginTop={idx === 0 ? 0 : 0}>
          <ToolBlock entry={entry} details={details} />
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
 * Estimated rendered height of the tool progress view.
 * Pure — used by the shell to fit the progress view into the content region.
 *
 * Collapsed successful runs are ONE line. Active/failed runs are TWO
 * (label + status). With `details` on, completed runs are TWO as well.
 * Plus the mission terminal line (if shown).
 */
export function estimateToolProgressHeight(progress: ToolProgressSnapshot, details = false): number {
  if (progress.entries.length === 0 && !progress.missionActive) return 0;
  let lines = 0;
  for (const entry of progress.entries) {
    if (entry.status === "completed" && !details) lines += 1;
    else lines += 2;
  }
  const missionLine = (progress.missionStatus === "completed" || progress.missionStatus === "failed") && progress.entries.length > 0 ? 2 : 0; // marginTop(1) + line
  return lines + missionLine;
}
