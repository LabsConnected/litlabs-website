/**
 * ShortcutHints — the keyboard shortcut reference row (spec §2/§16/§60).
 *
 * Wide:    tab agents   ctrl+p commands   ctrl+k models   ctrl+l activity
 * Standard: tab agents   ctrl+p commands   ctrl+k models   ctrl+l activity
 * Narrow:   ctrl+p · ctrl+k · ctrl+l · esc
 *
 * Agent/context hints are shown but marked "(soon)" where the runtime
 * does not yet provide a registry — no fabricated capabilities.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { LayoutBand } from "./use-terminal-size.js";

export interface ShortcutHintsProps {
  band: LayoutBand;
}

export function ShortcutHints({ band }: ShortcutHintsProps): React.ReactElement {
  if (band === "narrow") {
    return (
      <Box>
        <Text dimColor>{" ctrl+p · ctrl+k · ctrl+l · esc"}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text dimColor>
        {" tab agents   ctrl+p commands   ctrl+k models   ctrl+l activity"}
      </Text>
    </Box>
  );
}
