/**
 * Welcome — the idle LiTT shell face.
 *
 * One-shot entrance (~300ms): "LiTT" fades in, then tagline, then prompt
 * + hints. Then it is STATIC — never animates again. The moment the user
 * submits, this area becomes the transcript inside the SAME reserved
 * region — no reflow, no jumping.
 *
 * Minimal on purpose: this is a developer instrument, not a dashboard.
 * No letter-spacing on the brand. No giant ASCII logo. No visual noise.
 *
 * Visual upgrade (2026-08-29):
 *   - Hints laid out vertically on narrow terminals
 *   - Subtle separator below brand
 *   - Cleaner hint formatting
 *   - Tagline in brand purple (not dim) for identity presence
 *   - Prompt in bright text with brand accent for dominance
 *   - Hints in slightly brighter dim for readability
 *   - Repo status line: "litlabs-website · main · Git clean"
 *   - "Local tools ready" indicator
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../colors.js";
import { classifyWidth, SectionDivider, RepoStateBadge } from "../ui-primitives.js";
import { LiTTMark } from "../litt-mark.js";

const REVEAL_MS = 300;

export interface WelcomeProps {
  /** Project name (e.g. "litlabs-website"). */
  project?: string;
  /** Branch name (e.g. "main"). */
  branch?: string;
  /** Git modified file count. */
  gitModified?: number;
  /** Git untracked file count. */
  gitUntracked?: number;
  /** Execution target — "local" or "remote". */
  executionTarget?: "local" | "remote";
}

export function Welcome({
  project,
  branch,
  gitModified = 0,
  gitUntracked = 0,
  executionTarget = "local",
}: WelcomeProps = {}): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const w = classifyWidth(width);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setRevealed(true), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  const pad = Math.max(2, Math.floor((width - 24) / 2));

  return (
    <Box flexDirection="column" paddingTop={3}>
      <Box paddingLeft={pad}>
        <LiTTMark state="idle" showWordmark />
      </Box>

      {revealed && (
        <>
          <Box paddingLeft={pad} marginTop={0}>
            <SectionDivider width={20} />
          </Box>

          <Box paddingLeft={pad} marginTop={1}>
            <Text color={COLORS.brand} bold>BUILD · SHIP · CREATE</Text>
          </Box>

          <Box paddingLeft={pad} marginTop={2}>
            <Text color={COLORS.textBright} bold>What do you want to build?</Text>
          </Box>

          {/* Repo status line — only show if project is known */}
          {project && (
            <Box paddingLeft={pad} marginTop={2}>
              <Text>
                <Text color={COLORS.secondary}>{project}</Text>
                {branch && (
                  <>
                    <Text dimColor> · </Text>
                    <Text color={COLORS.secondaryBright}>{branch}</Text>
                  </>
                )}
                <Text dimColor> · </Text>
                <RepoStateBadge modified={gitModified} untracked={gitUntracked} />
              </Text>
            </Box>
          )}

          {/* Local tools ready indicator */}
          <Box paddingLeft={pad} marginTop={0}>
            <Text color={COLORS.success} dimColor>
              {executionTarget === "local" ? "Local tools ready" : "Remote tools ready"}
            </Text>
          </Box>

          <Box paddingLeft={pad} marginTop={2}>
            {w === "narrow" ? (
              <Box flexDirection="column">
                <Text color={COLORS.secondary}>  / commands</Text>
                <Text color={COLORS.secondary}>  @ context</Text>
                <Text color={COLORS.secondary}>  ? help</Text>
              </Box>
            ) : (
              <Text>
                <Text color={COLORS.secondary}>  / commands</Text>
                <Text color={COLORS.secondaryDim}>    </Text>
                <Text color={COLORS.secondary}>@ context</Text>
                <Text color={COLORS.secondaryDim}>    </Text>
                <Text color={COLORS.secondary}>? help</Text>
              </Text>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
