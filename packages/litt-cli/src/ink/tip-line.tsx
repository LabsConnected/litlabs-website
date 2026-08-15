/**
 * TipLine — subtle contextual tip (spec §35).
 *
 * Tips rotate slowly or react to current mode. No aggressive animation.
 * One tip shown at a time, dim/secondary color.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";

const TIPS: string[] = [
  "Tip: Type /plan to inspect before execution",
  "Tip: Ctrl+K changes model",
  "Tip: @ adds files to context",
  "Tip: /verify runs the runtime truth gate",
  "Tip: Esc cancels an active run",
  "Tip: /status shows runtime + project truth",
];

export interface TipLineProps {
  /** Index into the tip list; caller rotates slowly. */
  index: number;
}

export function TipLine({ index }: TipLineProps): React.ReactElement {
  const tip = TIPS[index % TIPS.length];
  return (
    <Box>
      <Text color={COLORS.brand}>{"● "}</Text>
      <Text dimColor>{tip}</Text>
    </Box>
  );
}

export { TIPS };
