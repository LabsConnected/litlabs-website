/**
 * Welcome — the idle LiTT shell face.
 *
 * One-shot entrance (~300ms): the shard fades in, then the prompt and
 * concrete suggestions. Then it is STATIC — never animates again. The
 * moment the user submits, this area becomes the transcript inside the
 * SAME reserved region — no reflow, no jumping.
 *
 * Minimal on purpose: the header identity bar already owns project,
 * branch, and lane state — the welcome doesn't repeat them. This is
 * the one place the larger mark is welcome; conversation uses ◈.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../colors.js";
import { classifyWidth } from "../ui-primitives.js";
import { LiTTMark } from "../litt-mark.js";

const REVEAL_MS = 300;

export interface WelcomeProps {
  /** Project name — retained for call-site compatibility. */
  project?: string;
  branch?: string;
  gitModified?: number;
  gitUntracked?: number;
  executionTarget?: "local" | "remote";
}

export function Welcome(_props: WelcomeProps = {}): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const w = classifyWidth(width);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setRevealed(true), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  return (
    <Box flexDirection="column" paddingTop={2}>
      <LiTTMark state="idle" showWordmark />

      {revealed && (
        <>
          <Box marginTop={2}>
            <Text color={COLORS.textBright} bold>What do you want to build?</Text>
          </Box>

          {w !== "narrow" && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Try something concrete:</Text>
              <Text color={COLORS.secondary}>{"  "}Review my changes</Text>
              <Text color={COLORS.secondary}>{"  "}Find the authentication flow</Text>
              <Text color={COLORS.secondary}>{"  "}Run the build and investigate failures</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
