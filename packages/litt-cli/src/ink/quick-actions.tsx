/**
 * QuickActions — slash command shortcuts row.
 *
 * Shows the most common actions as a quick reference.
 * Not interactive — just a visual guide.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";

const ACTIONS = ["/build", "/debug", "/test", "/diff", "/status", "/ship"];

export function QuickActions(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor bold>QUICK ACTIONS</Text>
      <Box gap={1}>
        {ACTIONS.map((action, idx) => (
          <Box key={action}>
            <Text color={COLORS.working}>{action}</Text>
            {idx < ACTIONS.length - 1 && <Text dimColor>   </Text>}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
