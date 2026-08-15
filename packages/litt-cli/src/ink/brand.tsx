/**
 * Brand — LiTT identity, responsive (spec §11/§12).
 *
 * Wide:    compact ASCII logo + subtitle
 * Standard: "LiTT" wordmark + subtitle
 * Narrow:   "LiTT" wordmark only
 *
 * Branding never crowds out useful information. No giant ASCII art.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import type { LayoutBand } from "./use-terminal-size.js";

export interface BrandProps {
  band: LayoutBand;
}

const ASCII_LOGO = [
  "██╗     ██╗████████╗████████╗",
  "██║     ██║╚══██╔══╝╚══██╔══╝",
  "██║     ██║   ██║      ██║",
  "██║     ██║   ██║      ██║",
  "███████╗██║   ██║      ██║",
  "╚══════╝╚═╝   ╚═╝      ╚═╝",
];

export function Brand({ band }: BrandProps): React.ReactElement {
  if (band === "wide") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {ASCII_LOGO.map((line, i) => (
          <Text key={i} color={COLORS.brand} bold>{line}</Text>
        ))}
        <Text dimColor>{" AI DEVELOPMENT OS"}</Text>
      </Box>
    );
  }

  if (band === "standard") {
    return (
      <Box flexDirection="column" marginBottom={0}>
        <Text bold color={COLORS.brand}>LiTT</Text>
        <Text dimColor>AI DEVELOPMENT OS</Text>
      </Box>
    );
  }

  // narrow
  return (
    <Box marginBottom={0}>
      <Text bold color={COLORS.brand}>LiTT</Text>
    </Box>
  );
}
