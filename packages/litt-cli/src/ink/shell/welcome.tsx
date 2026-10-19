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
 *
 * Startup-experience upgrade (2026-10-19):
 *   - Brain/routing line ("LiTT Auto → GPT-5.6 Luna") — the same label the
 *     status bar shows, so the welcome screen never contradicts the
 *     footer. Already resolved synchronously from store state; no extra
 *     network call delays the reveal.
 *   - A single-key shortcut row ([Enter] Start [H] Health [M] Models
 *     [S] Settings) — the keys are handled by the Composer (see
 *     composer.tsx's welcomeShortcutsEnabled/onWelcomeShortcut), which
 *     already owns all printable input. They only intercept h/m/s on a
 *     still-empty draft, before the user has typed anything.
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
  /** The resolved routing/brain label (e.g. "LiTT Auto → GPT-5.6 Luna") —
   *  the SAME string the status bar shows, so the welcome screen never
   *  disagrees with the footer. Always resolved synchronously from store
   *  state; never blocks the initial reveal. */
  brain?: string;
}

export function Welcome({
  project,
  branch,
  gitModified = 0,
  gitUntracked = 0,
  executionTarget = "local",
  brain,
}: WelcomeProps = {}): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;
  const w = classifyWidth(width);
  // The shell reserves seven rows for composer + footer chrome. At the
  // common 80x24 size the full welcome would overflow its 17-row center.
  // The full composition needs 21 center rows, while shell chrome reserves
  // seven, so compact through 28 terminal rows.
  const short = rows <= 28;
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setRevealed(true), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  const pad = w === "narrow" ? 2 : Math.max(0, Math.floor((width - 24) / 2));
  const welcomeWidth = Math.max(20, width - 4);

  return (
    <Box flexDirection="column" paddingTop={short ? 0 : 2}>
      <Box paddingLeft={pad}>
        <LiTTMark state="idle" showWordmark />
      </Box>

      {revealed && (
        <>
          {!short && (
            <>
              <Box paddingLeft={pad} marginTop={0}>
                <SectionDivider width={20} />
              </Box>
              <Box paddingLeft={pad} marginTop={1}>
                <Text color={COLORS.brand} bold>BUILD · SHIP · CREATE</Text>
              </Box>
            </>
          )}

          <Box paddingLeft={pad} marginTop={short ? 0 : 2}>
            <Text color={COLORS.textBright} bold>What do you want to build?</Text>
          </Box>

          {/* Repo status line — only show if project is known */}
          {project && (
            <Box paddingLeft={pad} marginTop={short ? 0 : 2} width={welcomeWidth}>
              <Text wrap="truncate-end">
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
          <Box paddingLeft={pad} marginTop={0} width={welcomeWidth}>
            <Text wrap="truncate-end">
              <Text color={COLORS.success} dimColor>
                {executionTarget === "local" ? "Local tools ready" : "Remote tools ready"}
              </Text>
              {brain && short && <Text color={COLORS.secondaryBright} dimColor>{` · ${brain}`}</Text>}
            </Text>
          </Box>

          {/* Brain/routing line — same label as the status bar footer. */}
          {brain && !short && (
            <Box paddingLeft={pad} marginTop={0} width={welcomeWidth}>
              <Text color={COLORS.secondaryBright} dimColor wrap="truncate-end">{brain}</Text>
            </Box>
          )}

          {/* Primary shortcut row — Enter starts; H/M/S are single-key
              jumps to Health/Models/Settings, handled by the Composer
              only while the draft is still empty. */}
          <Box paddingLeft={pad} marginTop={short ? 0 : 2} width={welcomeWidth}>
            {w !== "wide" ? (
              <Box flexDirection="column">
                <Text color={COLORS.secondary}>[Enter] Start  [H] Health</Text>
                <Text color={COLORS.secondary}>[M] Models     [S] Settings</Text>
              </Box>
            ) : (
              <Text>
                <Text color={COLORS.secondary}>  [Enter] Start</Text>
                <Text color={COLORS.secondaryDim}>    </Text>
                <Text color={COLORS.secondary}>[H] Health</Text>
                <Text color={COLORS.secondaryDim}>    </Text>
                <Text color={COLORS.secondary}>[M] Models</Text>
                <Text color={COLORS.secondaryDim}>    </Text>
                <Text color={COLORS.secondary}>[S] Settings</Text>
              </Text>
            )}
          </Box>

          {!short && <Box paddingLeft={pad} marginTop={1} width={welcomeWidth}>
            {w === "narrow" ? (
              <Box flexDirection="column">
                <Text color={COLORS.secondaryDim}>  / commands</Text>
                <Text color={COLORS.secondaryDim}>  @ context</Text>
                <Text color={COLORS.secondaryDim}>  ? help</Text>
              </Box>
            ) : (
              <Text>
                <Text color={COLORS.secondaryDim}>  / commands</Text>
                <Text color={COLORS.secondaryDim}>    </Text>
                <Text color={COLORS.secondaryDim}>@ context</Text>
                <Text color={COLORS.secondaryDim}>    </Text>
                <Text color={COLORS.secondaryDim}>? help</Text>
              </Text>
            )}
          </Box>}
        </>
      )}
    </Box>
  );
}
