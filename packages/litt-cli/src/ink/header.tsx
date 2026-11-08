/**
 * Header — the compact LiTT identity bar.
 *
 * ```
 *   ◈ LiTT                                          Ollama · local
 *   litlabs-website / fix/studio-mission-20261030
 *   ──────────────────────────────────────────────────────────────
 * ```
 *
 * One row of identity, one row of workspace context, one divider —
 * everything shares the shell's content column. Diagnostic badges
 * (LOCAL/TOOLS/SIGNED OUT) were removed: the right side states the
 * provider lane and execution target, the account state lives in
 * /whoami and /status, and real tool work shows in the transcript
 * instead of as a permanent capability badge.
 *
 * Truthfulness: the right-hand lane label reflects the CONFIGURED
 * executionTarget and the probed lane — "Ollama · local" only when a
 * local daemon actually answered, otherwise the honest failure/pending
 * state. It never claims a provider this session cannot call.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import type { ExecutionTarget } from "../lib/execution-target.js";
import { SectionDivider, classifyWidth, truncateMid } from "./ui-primitives.js";
import { LiTTMark } from "./litt-mark.js";
import { CONTENT_MEASURE, shortModelName } from "./text-wrap.js";

export interface HeaderProps {
  project: string;
  projectRoot: string;
  branch: string;
  /** Brain label — the configured model/policy identity. */
  brain: string;
  /** Active model — what the runtime actually used (null until first run) */
  activeModel: string | null;
  /** Provider lane label for the right side (e.g. "Ollama", "OpenRouter"). */
  providerLane: string;
  /** Whether the provider lane is confirmed reachable. */
  laneReady: boolean;
  /** Lane failure reason — shown when the lane is not ready. */
  laneError?: string | null;
  connected: boolean;
  /** The CONFIGURED execution target (see lib/execution-target.ts). */
  executionTarget: ExecutionTarget;
  localRuntime: string;
  remoteRuntime: string;
  mode: string;
  /** Git dirty-file count (modified + untracked). */
  gitModified?: number;
  gitUntracked?: number;
  /** Auth email — retained for call-site compat; not rendered. */
  authEmail?: string | null;
  /** Retained for call-site compat; account state lives in /status. */
  signedIn?: boolean;
  /** Compact flag retained for call-site compat. */
  compact?: boolean;
}

export function Header({
  project,
  branch,
  brain,
  activeModel,
  providerLane,
  laneReady,
  laneError,
  executionTarget,
  gitModified = 0,
  gitUntracked = 0,
}: HeaderProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const w = classifyWidth(width);
  // Shared content column — identical to LiTTShell's contentWidth so the
  // header, divider, transcript, composer, and footer share left/right edges.
  const contentWidth = Math.max(32, Math.min(CONTENT_MEASURE, width - 4));

  // Right side: "{model} · {lane} · {target}" — the model the next turn
  // will actually use (the compact header detail), the probed lane, and
  // the configured target. On narrow terminals the model drops first.
  const target = executionTarget === "remote" ? "remote" : "local";
  const laneColor = laneReady ? COLORS.secondary : laneError ? COLORS.error : COLORS.warning;
  const laneCore = laneReady
    ? `${providerLane} · ${target}`
    : laneError
      ? `${providerLane} ✗ · ${target}`
      : `${providerLane}… · ${target}`;
  // The brain label is the configured identity (what WILL serve); the
  // active model is what last actually served — prefer it when known.
  const model = w !== "narrow" ? (activeModel ?? brain) : null;
  const laneText = model ? `${shortModelName(model)} · ${laneCore}` : laneCore;

  const dirty = gitModified + gitUntracked;
  const projectLine = branch && branch !== "unknown"
    ? `${project} / ${branch}`
    : project;

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box flexDirection="column" width={contentWidth}>
        <Box justifyContent="space-between">
          <LiTTMark state={executionTarget === "remote" ? "remote" : "local"} showWordmark size={w === "narrow" ? "compact" : "normal"} />
          <Text color={laneColor}>{laneText}</Text>
        </Box>
        {w !== "narrow" && projectLine.length > 0 && (
          <Text dimColor>{truncateMid(projectLine, contentWidth - (dirty > 0 ? 18 : 0))}{dirty > 0 ? ` · ${dirty} changed file${dirty === 1 ? "" : "s"}` : ""}</Text>
        )}
        {w === "narrow" && project.length > 0 && (
          <Text dimColor>{truncateMid(project, contentWidth)}</Text>
        )}
        <SectionDivider width={contentWidth} />
      </Box>
    </Box>
  );
}
