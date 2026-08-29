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
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../colors.js";
import { classifyWidth, SectionDivider } from "../ui-primitives.js";

const REVEAL_MS = 300;

export function Welcome(): React.ReactElement {
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
        <Text bold color={COLORS.brand}>LiTT</Text>
      </Box>

      {revealed && (
        <>
          <Box paddingLeft={pad} marginTop={0}>
            <SectionDivider width={20} />
          </Box>

          <Box paddingLeft={pad} marginTop={1}>
            <Text dimColor>BUILD · SHIP · CREATE</Text>
          </Box>

          <Box paddingLeft={pad} marginTop={2}>
            <Text color={COLORS.text}>What do you want to build?</Text>
          </Box>

          <Box paddingLeft={pad} marginTop={2}>
            {w === "narrow" ? (
              <Box flexDirection="column">
                <Text dimColor>/ commands</Text>
                <Text dimColor>@ context</Text>
                <Text dimColor>? help</Text>
              </Box>
            ) : (
              <Text>
                <Text dimColor>/ commands</Text>
                <Text dimColor>    </Text>
                <Text dimColor>@ context</Text>
                <Text dimColor>    </Text>
                <Text dimColor>? help</Text>
              </Text>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
