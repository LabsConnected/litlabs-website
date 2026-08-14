/**
 * Header — project, branch, model, runtime connection.
 *
 * Reads from RuntimeClient state. No business logic.
 */

import React from "react";
import { Box, Text } from "ink";

export interface HeaderProps {
  project: string;
  branch: string;
  model: string;
  connected: boolean;
}

export function Header({ project, branch, model, connected }: HeaderProps): React.ReactElement {
  const connColor = connected ? "\x1b[32m" : "\x1b[31m";
  const connIcon = connected ? "●" : "○";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="magenta">LiTT Cockpit</Text>
        <Text dimColor> ── </Text>
        <Text color="cyan">{project}</Text>
        <Text dimColor> / </Text>
        <Text color="yellow">{branch}</Text>
      </Box>
      <Box>
        <Text dimColor>Model: </Text>
        <Text color="blue">{model}</Text>
        <Text dimColor> │ Runtime: </Text>
        <Text color={connected ? "green" : "red"}>{connIcon} {connected ? "connected" : "offline"}</Text>
      </Box>
    </Box>
  );
}
