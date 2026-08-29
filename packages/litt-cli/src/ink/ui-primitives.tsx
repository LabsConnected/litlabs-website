/**
 * UI primitives — reusable visual building blocks for the LiTT shell.
 *
 * These are PRESENTATION-only components. They read no runtime state
 * and execute no logic. They exist so visual consistency comes from
 * one place, not scattered inline styling.
 *
 * Design principles:
 *   - Thin separators, not heavy boxes
 *   - Subtle dim borders, not loud colors
 *   - Typography hierarchy over visual decoration
 *   - Color is NEVER the only state indicator — always pair with glyph
 *   - Responsive: collapse gracefully on narrow terminals
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";

// ─── Terminal width breakpoints ───────────────────────────────────

export type TerminalWidth = "narrow" | "normal" | "wide";

/** Classify terminal width into responsive buckets. */
export function classifyWidth(columns: number): TerminalWidth {
  if (columns < 60) return "narrow";   // Termux / phone
  if (columns < 100) return "normal";  // Standard terminal
  return "wide";                        // Desktop / large
}

// ─── SectionDivider ───────────────────────────────────────────────

export interface SectionDividerProps {
  /** Override the character (default: thin horizontal line). */
  char?: string;
  /** Override the color (default: secondaryDim). */
  color?: string;
  /** Width override (default: terminal width - padding). */
  width?: number;
}

/** A thin horizontal separator — subtle, not heavy. */
export function SectionDivider({ char = "─", color = COLORS.secondaryDim, width }: SectionDividerProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = width ?? Math.max(20, Math.min((stdout?.columns ?? 80) - 4, 72));
  return <Text color={color}>{char.repeat(cols)}</Text>;
}

// ─── RuntimeBadge ─────────────────────────────────────────────────

export type BadgeState = "active" | "connecting" | "error" | "inactive";

export interface RuntimeBadgeProps {
  /** The glyph: ● ○ ✗ ◈ */
  glyph: string;
  /** The label: LOCAL REMOTE AUTO TOOLS */
  label: string;
  /** Visual state determines color. */
  state: BadgeState;
  /** Dim the badge (e.g. when the target is not the active one). */
  dim?: boolean;
}

const STATE_COLORS: Record<BadgeState, string> = {
  active: COLORS.success,
  connecting: COLORS.warning,
  error: COLORS.error,
  inactive: COLORS.secondary,
};

const STATE_GLYPHS: Record<BadgeState, string> = {
  active: "●",
  connecting: "○",
  error: "✗",
  inactive: "○",
};

/** A runtime status badge: glyph + label, state-colored. */
export function RuntimeBadge({ glyph, label, state, dim }: RuntimeBadgeProps): React.ReactElement {
  const color = STATE_COLORS[state];
  const effectiveGlyph = glyph || STATE_GLYPHS[state];
  return (
    <Text color={color} dimColor={dim}>
      {effectiveGlyph} {label}
    </Text>
  );
}

// ─── ModeToggle ───────────────────────────────────────────────────

export interface ModeToggleProps {
  /** Current active mode. */
  active: "plan" | "act";
}

/** Plan/Act toggle indicator — active is bold + brand, inactive is dim. */
export function ModeToggle({ active }: ModeToggleProps): React.ReactElement {
  const planActive = active === "plan";
  const actActive = active === "act";
  return (
    <Text>
      <Text color={planActive ? COLORS.brand : COLORS.secondary} bold={planActive}>
        {planActive ? "●" : "○"} Plan
      </Text>
      <Text dimColor>   </Text>
      <Text color={actActive ? COLORS.brand : COLORS.secondary} bold={actActive}>
        {actActive ? "●" : "○"} Act
      </Text>
    </Text>
  );
}

// ─── RepoStateBadge ───────────────────────────────────────────────

export interface RepoStateBadgeProps {
  modified: number;
  untracked: number;
}

/** Repository dirty/clean indicator. Clean is subtle, dirty is warning. */
export function RepoStateBadge({ modified, untracked }: RepoStateBadgeProps): React.ReactElement {
  const total = modified + untracked;
  if (total === 0) {
    return <Text color={COLORS.success} dimColor>clean</Text>;
  }
  return (
    <Text>
      <Text color={COLORS.warning} dimColor> +{total}</Text>
      <Text dimColor> changes</Text>
    </Text>
  );
}

// ─── ExecutionResultBlock ─────────────────────────────────────────

export interface ExecutionResultBlockProps {
  /** The locus tag: LOCAL ·, REMOTE ·, etc. */
  locus: string;
  /** The command or action that was executed. */
  command: string;
  /** Exit code or status. */
  exitCode?: number | null;
  /** Duration in milliseconds. */
  durationMs?: number | null;
  /** Output lines (already truncated by the caller). */
  output?: string[];
  /** Additional metadata (e.g. "No remote contact"). */
  note?: string;
  /** Content width for truncation. */
  width?: number;
}

/** A grouped execution result block with a header, output, and metadata. */
export function ExecutionResultBlock({
  locus, command, exitCode, durationMs, output, note, width = 80,
}: ExecutionResultBlockProps): React.ReactElement {
  const success = exitCode === 0 || exitCode === null;
  const glyph = success ? "✓" : "×";
  const glyphColor = success ? COLORS.success : COLORS.error;
  const durationStr = durationMs != null ? `${Math.round(durationMs)}ms` : "";
  const maxOutput = Math.max(0, width - 4);

  return (
    <Box flexDirection="column">
      {/* Header line: LOCUS · command */}
      <Box>
        <Text color={COLORS.secondaryBright} bold>{locus}</Text>
        <Text dimColor> · </Text>
        <Text color={COLORS.text}>{truncateMid(command, maxOutput - locus.length - 4)}</Text>
      </Box>
      <SectionDivider width={Math.min(width, 72)} />
      {/* Status line */}
      <Box>
        <Text color={glyphColor} bold>{glyph} </Text>
        <Text color={success ? COLORS.success : COLORS.error}>
          {exitCode != null ? `exit ${exitCode}` : "complete"}
        </Text>
        {durationStr && <Text dimColor> · {durationStr}</Text>}
      </Box>
      {/* Output lines */}
      {output && output.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {output.slice(0, 5).map((line, i) => (
            <Text key={i} color={COLORS.text} dimColor>{truncateMid(line, maxOutput)}</Text>
          ))}
        </Box>
      )}
      {/* Note (e.g. "No remote contact") */}
      {note && <Text dimColor>{note}</Text>}
    </Box>
  );
}

// ─── MissionProgress ──────────────────────────────────────────────

export interface MissionStep {
  label: string;
  status: "complete" | "active" | "pending" | "failed" | "warning";
}

export interface MissionProgressProps {
  title: string;
  steps: MissionStep[];
  elapsedMs?: number | null;
  width?: number;
}

const STEP_GLYPHS: Record<MissionStep["status"], { glyph: string; color: string }> = {
  complete: { glyph: "✓", color: COLORS.success },
  active: { glyph: "→", color: COLORS.working },
  pending: { glyph: "○", color: COLORS.secondaryDim },
  failed: { glyph: "×", color: COLORS.error },
  warning: { glyph: "!", color: COLORS.warning },
};

/** Compact mission progress with step list and elapsed time. */
export function MissionProgress({ title, steps, elapsedMs, width = 80 }: MissionProgressProps): React.ReactElement {
  const complete = steps.filter(s => s.status === "complete").length;
  const total = steps.length;
  const elapsedStr = elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={COLORS.text} bold>{title}</Text>
        <Text dimColor> · {complete}/{total} complete</Text>
        {elapsedStr && <Text dimColor> · {elapsedStr}</Text>}
      </Box>
      <SectionDivider width={Math.min(width, 60)} />
      {steps.map((step, i) => {
        const { glyph, color } = STEP_GLYPHS[step.status];
        return (
          <Box key={i}>
            <Text color={color} bold>{glyph} </Text>
            <Text color={step.status === "pending" ? COLORS.secondaryDim : COLORS.text} dimColor={step.status === "pending"}>
              {step.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── ComposerModeHint ─────────────────────────────────────────────

export interface ComposerModeHintProps {
  /** The current input value. */
  value: string;
}

/** A subtle hint below the composer showing the current input mode. */
export function ComposerModeHint({ value }: ComposerModeHintProps): React.ReactElement | null {
  if (!value) return null;
  if (value.startsWith("/")) {
    const spaceIdx = value.indexOf(" ");
    if (spaceIdx === -1) {
      return <Text dimColor>  COMMAND</Text>;
    }
    return <Text dimColor>  COMMAND · args</Text>;
  }
  if (value.startsWith("@")) {
    return <Text dimColor>  CONTEXT</Text>;
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Truncate from the middle (keep start + end) for long paths/commands. */
export function truncateMid(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max < 8) return text.slice(0, max);
  const keep = max - 1; // leave room for …
  const startLen = Math.ceil(keep * 0.6);
  const endLen = Math.floor(keep * 0.4);
  return text.slice(0, startLen) + "…" + text.slice(-endLen);
}

/** Truncate from the tail (keep start) for labels. */
export function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max < 3) return text.slice(0, max);
  return text.slice(0, max - 1) + "…";
}
