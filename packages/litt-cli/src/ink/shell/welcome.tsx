/**
 * Welcome — the idle LiTT shell face.
 *
 * Centered logo with a subtle one-shot entrance animation (~450ms):
 * letters of "LiTT" appear one at a time, then the tagline, then the
 * prompt + hints. Then it is STATIC — never animates again.
 *
 * Rendered ONLY while the transcript is empty and nothing is running.
 * The moment the user submits, this area becomes the transcript (the
 * shell swaps content in place — no reflow, no jumping).
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../colors.js";

const LETTER_DELAY_MS = 110;

export function Welcome(): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const [frame, setFrame] = useState(0);

  // One-shot entrance: L → L i → L i T → L i T T (+ tagline/hints at the end).
  useEffect(() => {
    if (frame >= 4) return;
    const t = setTimeout(() => setFrame((f) => f + 1), LETTER_DELAY_MS);
    return () => clearTimeout(t);
  }, [frame]);

  const letters = ["L", "i", "T", "T"].slice(0, frame).join(" ");
  const full = frame >= 4;
  const pad = Math.max(0, Math.floor((width - 20) / 2));

  return (
    <Box flexDirection="column" paddingY={full ? 2 : 4}>
      <Box paddingLeft={pad}>
        <Text bold color={COLORS.brand}>
          {full ? "L i T T" : letters}
        </Text>
      </Box>

      {full && (
        <>
          <Box paddingLeft={pad} marginTop={1}>
            <Text dimColor>build · ship · create</Text>
          </Box>
          <Box paddingLeft={pad} marginTop={2}>
            <Text color={COLORS.text}>What are we making tonight?</Text>
          </Box>
          <Box paddingLeft={pad} marginTop={1}>
            <Text dimColor>/ commands</Text>
            <Text dimColor>   </Text>
            <Text dimColor>@ context</Text>
            <Text dimColor>   </Text>
            <Text dimColor>Tab plan/act</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
