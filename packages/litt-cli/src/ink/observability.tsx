/**
 * Observability blocks — "watch LiTT work" with structured, meaningful
 * execution cards instead of raw status noise.
 *
 * Four block types:
 *   1. ThinkingBlock  — active reasoning/execution phase
 *   2. ToolResultBlock — command/tool runs in grouped form
 *   3. MissionProgressBlock — multi-step mission progress
 *   4. SummaryBlock   — LiTT's conclusion in plain English
 *
 * Design principles:
 *   - Less spam, more meaning
 *   - Every block has a clear header (LOCUS · action)
 *   - Status is always paired with a glyph (✓ × → ○)
 *   - LOCAL vs REMOTE is always visible
 *   - Compact — no giant boxes, no empty padding
 *   - Collapses gracefully on narrow terminals
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import { SectionDivider, classifyWidth, truncateMid } from "./ui-primitives.js";

// ─── Execution locus ───────────────────────────────────────────────

export type Locus = "LOCAL" | "REMOTE" | "AUTO";

function locusColor(locus: Locus): string {
  switch (locus) {
    case "LOCAL": return COLORS.success;
    case "REMOTE": return COLORS.remote;
    case "AUTO": return COLORS.brand;
  }
}

// ─── 1. ThinkingBlock ──────────────────────────────────────────────

export interface ThinkingStep {
  label: string;
  status: "complete" | "active" | "pending";
}

export interface ThinkingBlockProps {
  /** The phase LiTT is in (ANALYZING, PLANNING, EXECUTING, etc.) */
  phase: string;
  /** Ordered steps with status. */
  steps: ThinkingStep[];
  /** Width override (default: terminal width - padding). */
  width?: number;
}

const THINK_GLYPHS: Record<ThinkingStep["status"], { glyph: string; color: string }> = {
  complete: { glyph: "✓", color: COLORS.success },
  active: { glyph: "→", color: COLORS.working },
  pending: { glyph: "○", color: COLORS.secondaryDim },
};

/**
 * ThinkingBlock — shows active reasoning/execution phase.
 *
 *   ◈ LiTT · ANALYZING
 *   ├─ ✓ project detected
 *   ├─ ✓ execution target: LOCAL
 *   ├─ → inspecting controller.ts
 *   └─ ○ preparing typecheck
 */
export function ThinkingBlock({ phase, steps, width }: ThinkingBlockProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = width ?? stdout?.columns ?? 80;
  const w = classifyWidth(cols);
  const maxLabel = Math.max(20, (w === "narrow" ? cols - 6 : cols - 8));

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLORS.brand} bold>◈ LiTT</Text>
        <Text dimColor> · </Text>
        <Text color={COLORS.working} bold>{phase}</Text>
      </Text>
      {steps.map((step, i) => {
        const { glyph, color } = THINK_GLYPHS[step.status];
        const isLast = i === steps.length - 1;
        const prefix = isLast ? "└─" : "├─";
        return (
          <Box key={i}>
            <Text dimColor>{prefix} </Text>
            <Text color={color} bold>{glyph} </Text>
            <Text
              color={step.status === "pending" ? COLORS.secondaryDim : COLORS.text}
              dimColor={step.status === "pending"}
            >
              {truncateMid(step.label, maxLabel)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── 2. ToolResultBlock ────────────────────────────────────────────

export interface ToolResultBlockProps {
  /** Where the tool ran. */
  locus: Locus;
  /** The command or tool name. */
  command: string;
  /** Exit code (null = not yet completed). */
  exitCode?: number | null;
  /** Duration in milliseconds. */
  durationMs?: number | null;
  /** Output lines (already truncated by caller if needed). */
  output?: string[];
  /** Whether the tool is still running. */
  running?: boolean;
  /** Width override. */
  width?: number;
}

/**
 * ToolResultBlock — shows command/tool runs in grouped form.
 *
 *   ╭─ LOCAL · pnpm typecheck ───────────────────────────╮
 *   │ ✓ exit 0                                   3.2s    │
 *   │                                                    │
 *   │ No type errors found.                              │
 *   ╰────────────────────────────────────────────────────╯
 *
 * On narrow terminals the border is dropped for space.
 */
export function ToolResultBlock({
  locus, command, exitCode, durationMs, output, running, width,
}: ToolResultBlockProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = width ?? stdout?.columns ?? 80;
  const w = classifyWidth(cols);
  const maxCmd = Math.max(15, cols - 12);
  const maxOutput = Math.max(20, cols - 4);
  const lc = locusColor(locus);

  const success = exitCode === 0;
  const glyph = running ? "→" : success ? "✓" : "×";
  const glyphColor = running ? COLORS.working : success ? COLORS.success : COLORS.error;
  const statusText = running ? "running"
    : exitCode != null ? `exit ${exitCode}`
    : "complete";
  const durationStr = durationMs != null
    ? `${durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`}`
    : "";
  const headerText = `${locus} · ${truncateMid(command, maxCmd)}`;

  if (w === "narrow") {
    // Borderless compact form for narrow terminals
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={lc} bold>{locus}</Text>
          <Text dimColor> · </Text>
          <Text color={COLORS.text}>{truncateMid(command, maxCmd)}</Text>
        </Text>
        <Text>
          <Text color={glyphColor} bold>{glyph} </Text>
          <Text color={glyphColor}>{statusText}</Text>
          {durationStr && <Text dimColor> · {durationStr}</Text>}
        </Text>
        {output && output.slice(0, 3).map((line, i) => (
          <Text key={i} color={COLORS.text} dimColor>{truncateMid(line, maxOutput)}</Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.secondaryDim} paddingX={1}>
      <Text>
        <Text color={lc} bold>{locus}</Text>
        <Text dimColor> · </Text>
        <Text color={COLORS.text}>{truncateMid(command, maxCmd)}</Text>
      </Text>
      <SectionDivider width={Math.min(cols - 6, 60)} />
      <Box justifyContent="space-between">
        <Text>
          <Text color={glyphColor} bold>{glyph} </Text>
          <Text color={glyphColor}>{statusText}</Text>
        </Text>
        {durationStr && <Text dimColor>{durationStr}</Text>}
      </Box>
      {output && output.slice(0, 5).map((line, i) => (
        <Text key={i} color={COLORS.text} dimColor>{truncateMid(line, maxOutput)}</Text>
      ))}
    </Box>
  );
}

// ─── 3. MissionProgressBlock ───────────────────────────────────────

export interface MissionStep {
  label: string;
  status: "complete" | "active" | "pending" | "failed";
}

export interface MissionProgressBlockProps {
  /** Mission title (e.g. "VERIFY PROJECT"). */
  title: string;
  /** Ordered steps. */
  steps: MissionStep[];
  /** Elapsed time in milliseconds. */
  elapsedMs?: number | null;
  /** Execution locus. */
  locus?: Locus;
  /** Width override. */
  width?: number;
}

const MISSION_GLYPHS: Record<MissionStep["status"], { glyph: string; color: string }> = {
  complete: { glyph: "✓", color: COLORS.success },
  active: { glyph: "→", color: COLORS.working },
  pending: { glyph: "○", color: COLORS.secondaryDim },
  failed: { glyph: "×", color: COLORS.error },
};

/**
 * MissionProgressBlock — multi-step mission progress.
 *
 *   ◆ VERIFY PROJECT                                  03/04
 *   ✓ Typecheck
 *   ✓ Unit tests
 *   ✓ Lint
 *   → Production build
 *
 *   18.4s · LOCAL
 */
export function MissionProgressBlock({
  title, steps, elapsedMs, locus, width,
}: MissionProgressBlockProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = width ?? stdout?.columns ?? 80;
  const maxLabel = Math.max(15, cols - 6);
  const complete = steps.filter(s => s.status === "complete").length;
  const total = steps.length;
  const progress = `${String(complete).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
  const elapsedStr = elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : "";
  const lc = locus ? locusColor(locus) : COLORS.secondary;

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text color={COLORS.brand} bold>◆ {title}</Text>
        </Text>
        <Text color={COLORS.secondaryBright} bold>{progress}</Text>
      </Box>
      {steps.map((step, i) => {
        const { glyph, color } = MISSION_GLYPHS[step.status];
        return (
          <Box key={i}>
            <Text color={color} bold>{glyph} </Text>
            <Text
              color={step.status === "pending" ? COLORS.secondaryDim : COLORS.text}
              dimColor={step.status === "pending"}
            >
              {truncateMid(step.label, maxLabel)}
            </Text>
          </Box>
        );
      })}
      {(elapsedStr || locus) && (
        <Text dimColor>
          {elapsedStr && `${elapsedStr}`}
          {elapsedStr && locus && " · "}
          {locus && <Text color={lc}>{locus}</Text>}
        </Text>
      )}
    </Box>
  );
}

// ─── 4. SummaryBlock ───────────────────────────────────────────────

export interface SummaryBlockProps {
  /** The summary text (plain English). */
  text: string;
  /** Whether the outcome was successful. */
  success?: boolean;
  /** Width override. */
  width?: number;
}

/**
 * SummaryBlock — LiTT's conclusion in plain English.
 *
 *   LiTT
 *   Typecheck is clean. One routing issue remains in controller.ts.
 */
export function SummaryBlock({ text, success = true, width }: SummaryBlockProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = width ?? stdout?.columns ?? 80;
  const maxText = Math.max(20, cols - 4);
  const color = success ? COLORS.brand : COLORS.error;

  return (
    <Box flexDirection="column">
      <Text color={color} bold>LiTT</Text>
      <Text color={COLORS.text}>{truncateMid(text, maxText)}</Text>
    </Box>
  );
}
