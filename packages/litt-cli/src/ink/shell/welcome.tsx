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
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../colors.js";

const REVEAL_MS = 300;

export function Welcome(): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const [revealed, setRevealed] = useState(false);

  // One-shot entrance: brand appears, then the rest fades in.
  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setRevealed(true), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  // Center the content responsively, but never narrower than 2 spaces.
  const pad = Math.max(2, Math.floor((width - 24) / 2));

  return (
    <Box flexDirection="column" paddingTop={3}>
      <Box paddingLeft={pad}>
        <Text bold color={COLORS.brand}>LiTT</Text>
      </Box>

      {revealed && (
        <>
          <Box paddingLeft={pad} marginTop={1}>
            <Text dimColor>BUILD · SHIP · CREATE</Text>
          </Box>

          <Box paddingLeft={pad} marginTop={2}>
            <Text color={COLORS.text}>What do you want to build?</Text>
          </Box>

          <Box paddingLeft={pad} marginTop={2}>
            <Text dimColor>/ commands</Text>
            <Text dimColor>    </Text>
            <Text dimColor>@ context</Text>
            <Text dimColor>    </Text>
            <Text dimColor>? help</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
