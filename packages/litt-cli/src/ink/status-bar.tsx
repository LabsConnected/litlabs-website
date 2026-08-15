/**
 * StatusBar — single bottom context line (spec §31).
 *
 * Wide:     C:\Dev\Homebase-3.0 | fix/litt-terminal-runtime-ui | GPT-5.6 Sol | ctx — | IDLE
 * Standard: Homebase-3.0 | fix/runtime-ui | SOL | ctx — | IDLE
 * Narrow:   Homebase-3.0 | SOL | ctx —
 *
 * Priority order if space is limited:
 *   1. project  2. run state  3. model  4. context  5. branch  6. version
 *
 * No fake statuses. Model shown only when the runtime has resolved one.
 * Context % is omitted until real token counts are wired in — shows
 * "ctx —" rather than fabricating a number (spec §33).
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS, stateColor } from "./colors.js";
import type { HoloState } from "./cockpit-store.js";

/** Shorten model name: "anthropic/claude-sonnet-4.6" → "Sonnet 4.6" */
function shortModelName(model: string | null): string {
  if (!model) return "";
  const withoutProvider = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const cleaned = withoutProvider
    .replace(/^claude-/, "Claude ")
    .replace(/^gpt-/, "GPT-")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^o1-/, "o1 ")
    .replace(/^o3-/, "o3 ")
    .replace(/-/g, " ");
  return cleaned.replace(/\b\w/, (c) => c.toUpperCase());
}

/** Truncate a string to fit, preserving the tail (most meaningful part). */
function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return "…" + text.slice(text.length - (max - 1));
}

/** Truncate a path to fit, preserving the head (drive letter) + tail. */
function truncatePath(path: string, max: number): string {
  if (path.length <= max) return path;
  if (max <= 3) return path.slice(0, max);
  const head = path.slice(0, 2);
  const tail = truncateTail(path, max - 3);
  return `${head}…${tail.slice(2)}`;
}

export interface StatusBarProps {
  connected: boolean;
  localRuntime: string;
  remoteRuntime: string;
  cwd: string;
  project: string;
  branch: string;
  holoState: HoloState;
  brain: string;
  activeModel: string | null;
  source: string;
  mode: string;
  runId: string | null;
  gitModified: number;
  gitUntracked: number;
}

export function StatusBar({
  localRuntime, cwd, project, branch, holoState, activeModel,
}: StatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const band = width >= 120 ? "wide" : width >= 80 ? "standard" : "narrow";

  const localIcon = localRuntime === "ready" ? "●" : "○";
  const localColor = localRuntime === "ready" ? COLORS.success : COLORS.warning;
  const sColor = stateColor(holoState);
  const modelShort = shortModelName(activeModel);
  // Context % is not yet wired to real token counts (spec §33).
  // Show "ctx —" rather than fabricating a number.
  const ctxLabel = "ctx —";
  const sep = " | ";

  if (band === "narrow") {
    const projectShort = truncateTail(project, 18);
    const modelTiny = modelShort ? truncateTail(modelShort, 10) : "";
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{"─".repeat(Math.min(width, 60))}</Text>
        <Box>
          <Text color={localColor}>{localIcon}</Text>
          <Text color={COLORS.working} bold>{` ${projectShort}`}</Text>
          {modelTiny && <Text dimColor>{sep}</Text>}
          {modelTiny && <Text color={COLORS.info}>{modelTiny}</Text>}
          <Text dimColor>{sep}</Text>
          <Text color={COLORS.secondary}>{ctxLabel}</Text>
        </Box>
      </Box>
    );
  }

  if (band === "standard") {
    const projectShort = truncateTail(project, 24);
    const branchShort = truncateTail(branch, 18);
    const modelStd = modelShort ? truncateTail(modelShort, 16) : "";
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{"─".repeat(Math.min(width, 60))}</Text>
        <Box>
          <Text color={localColor}>{localIcon}</Text>
          <Text color={COLORS.working} bold>{` ${projectShort}`}</Text>
          <Text dimColor>{sep}</Text>
          <Text color={COLORS.warning}>{branchShort}</Text>
          {modelStd && <Text dimColor>{sep}</Text>}
          {modelStd && <Text color={COLORS.info}>{modelStd}</Text>}
          <Text dimColor>{sep}</Text>
          <Text color={COLORS.secondary}>{ctxLabel}</Text>
          <Text dimColor>{sep}</Text>
          <Text color={sColor}>{holoState}</Text>
        </Box>
      </Box>
    );
  }

  // Wide: path | branch | model | ctx | state
  const pathShort = truncatePath(cwd, 36);
  const branchShort = truncateTail(branch, 28);
  const modelWide = modelShort ? truncateTail(modelShort, 20) : "";
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"─".repeat(Math.min(width, 72))}</Text>
      <Box>
        <Text color={localColor}>{localIcon}</Text>
        <Text color={COLORS.working} bold>{` ${pathShort}`}</Text>
        <Text dimColor>{sep}</Text>
        <Text color={COLORS.warning}>{branchShort}</Text>
        {modelWide && <Text dimColor>{sep}</Text>}
        {modelWide && <Text color={COLORS.info}>{modelWide}</Text>}
        <Text dimColor>{sep}</Text>
        <Text color={COLORS.secondary}>{ctxLabel}</Text>
        <Text dimColor>{sep}</Text>
        <Text color={sColor}>{holoState}</Text>
      </Box>
    </Box>
  );
}
