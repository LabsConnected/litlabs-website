/**
 * Workstream — the live "watch LiTT work" renderer.
 *
 * Renders ordered WorkstreamActivity blocks as compact, expressive lines:
 *
 *   ◉ Inspecting
 *     packages/litt-cli/src/ink/shell/shell.tsx
 *
 *   ◉ Working
 *     Found the viewport budget mismatch.
 *
 *   ◉ Editing
 *     shell.tsx                         +17  -4     ▸ diff
 *
 *   ◉ Testing
 *     transcript-scroll.test.ts         ✓ 31 passed
 *
 *   × Edit failed
 *     auth-config.ts
 *     Expected text was not found.
 *   ↻ Retrying
 *     Re-reading lines 120–165 and retrying a smaller patch.
 *
 * Design rules (per the live-workstream spec):
 *   - NO chain-of-thought: `reason` entries are concise conclusions only.
 *   - Failures stay visible even when a later retry succeeds.
 *   - Collapsed activity = one line; expandable diff/details reveal more.
 *   - Restrained glyphs, clear indentation, dim metadata, compact spacing.
 *   - Readable at 55 columns; richer at wider terminals.
 *   - New workstream events NEVER yank a scrolled viewport (the caller
 *     renders this only in live mode; the scroll model owns the anchor).
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { WorkstreamActivity, WorkstreamSnapshot, WorkstreamKind } from "./workstream-store.js";

/** Truncate to `max` chars, keeping the head and tail with an ellipsis. */
function truncateMid(str: string, max: number): string {
  if (max <= 0) return "";
  if (str.length <= max) return str;
  if (max <= 3) return str.slice(0, max);
  const keep = Math.floor((max - 1) / 2);
  return `${str.slice(0, keep)}…${str.slice(-keep)}`;
}


const GLYPH: Record<WorkstreamKind, { glyph: string; color: string }> = {
  inspect: { glyph: "◇", color: COLORS.secondaryBright },
  reason: { glyph: "◉", color: COLORS.brand },
  edit: { glyph: "✎", color: COLORS.brand },
  tool: { glyph: "⚙", color: COLORS.secondaryBright },
  command: { glyph: "$", color: COLORS.secondaryBright },
  test: { glyph: "✓", color: COLORS.success },
  verify: { glyph: "◼", color: COLORS.brand },
  warning: { glyph: "!", color: COLORS.warning },
  retry: { glyph: "↻", color: COLORS.warning },
  failure: { glyph: "×", color: COLORS.error },
  success: { glyph: "✓", color: COLORS.success },
};

function fmtMs(ms?: number | null): string {
  if (ms == null) return "";
  const s = ms / 1000;
  return s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(1)}s`;
}

/** Colorize a unified diff line by its leading marker. */
function diffColor(line: string): string {
  if (line.startsWith("+")) return COLORS.success;
  if (line.startsWith("-")) return COLORS.error;
  if (line.startsWith("@")) return COLORS.brand;
  return COLORS.secondaryDim;
}

/** One activity row (collapsed) or expanded block. */
function WorkstreamRow({ act, width }: { act: WorkstreamActivity; width: number }): React.ReactElement {
  const { glyph, color } = GLYPH[act.kind];
  const maxLabel = Math.max(16, width - 22);

  // ── Summary line (glyph + label + trailing metadata) ──
  const meta: string[] = [];
  if (act.kind === "edit" && act.added != null) meta.push(`+${act.added}`);
  if (act.kind === "edit" && act.removed != null) meta.push(`-${act.removed}`);
  if (act.kind === "test") {
    if (act.passed != null) meta.push(`✓ ${act.passed} passed`);
    if (act.failed != null) meta.push(`× ${act.failed} failed`);
    if (act.skipped != null && act.skipped > 0) meta.push(`- ${act.skipped}`);
  }
  if (act.elapsedMs != null) meta.push(fmtMs(act.elapsedMs));
  if (act.kind === "edit" && act.diff && act.diff.length > 0) meta.push(act.expanded ? "▾ hide" : "▸ diff");
  const metaText = meta.join("  ");

  const summary = (
    <Box>
      <Text color={color} bold={act.kind === "failure" || act.kind === "retry"}>{glyph} </Text>
      <Text color={act.status === "failed" ? COLORS.error : COLORS.text}>
        {truncateMid(act.label, maxLabel)}
      </Text>
      {act.subject && act.subject !== act.label ? (
        <Text dimColor> {truncateMid(act.subject, Math.max(8, width - 40))}</Text>
      ) : null}
      {metaText ? (
        <Text dimColor>  {truncateMid(metaText, Math.max(12, width - maxLabel - 8))}</Text>
      ) : null}
    </Box>
  );

  // ── Expanded detail ──
  let detail: React.ReactElement | null = null;
  if (act.diff && act.diff.length > 0 && act.expanded) {
    const visible = act.diff.slice(0, 24);
    const clipped = act.diff.length > visible.length;
    detail = (
      <>
        {visible.map((line, i) => (
          <Text key={i} color={diffColor(line)}>
            {"  "}{truncateMid(line, width - 2)}
          </Text>
        ))}
        {clipped && <Text dimColor>{"  "}… {act.diff.length - visible.length} more lines</Text>}
      </>
    );
  } else if (act.reason && (act.status === "failed" || act.kind === "retry" || act.kind === "warning")) {
    detail = <Text color={act.status === "failed" ? COLORS.error : COLORS.secondaryDim}>{"  "}{act.reason}</Text>;
  }

  return (
    <Box flexDirection="column">
      {summary}
      {detail}
    </Box>
  );
}


export interface WorkstreamProps {
  snapshot: WorkstreamSnapshot;
  /** Width override (default: safe 72). */
  width?: number;
  /** Max rows to render (helps the shell fit a fixed region). */
  maxRows?: number;
}

/**
 * Workstream — renders the live ordered activity stream.
 * Returns an array of rows for the shell to lay out inside the content
 * region. Row count ≤ maxRows (oldest dropped first).
 */
export function WorkstreamView({ snapshot, width = 72, maxRows = 40 }: WorkstreamProps): React.ReactElement | null {
  if (snapshot.activities.length === 0) return null;
  const shown = snapshot.activities.slice(-maxRows);
  return (
    <Box flexDirection="column">
      {shown.map((act) => (
        <WorkstreamRow key={act.id} act={act} width={width} />
      ))}
    </Box>
  );
}

/**
 * Pure row-count estimator — used by the shell to reserve space for the
 * fixed content region so a growing workstream never overflows / never
 * invents a scroll anchor jump. Expanded diffs count their visible lines.
 */
export function estimateWorkstreamRows(snapshot: WorkstreamSnapshot, maxRows = 40): number {
  const shown = snapshot.activities.slice(-maxRows);
  let rows = 0;
  for (const a of shown) {
    rows += 1; // summary line
    if (a.diff && a.diff.length > 0 && a.expanded) {
      rows += Math.min(a.diff.length, 24);
      if (a.diff.length > 24) rows += 1;
    } else if (a.reason && (a.status === "failed" || a.kind === "retry" || a.kind === "warning")) {
      rows += 1;
    }
  }
  return rows;
}
