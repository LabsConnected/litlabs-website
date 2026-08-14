/**
 * StatusBar — connection, cwd, execution state, context/model, current run.
 *
 * Reads from CockpitStore + RuntimeClient. No business logic.
 */

import React from "react";
import { Box, Text } from "ink";
import type { HoloState } from "./cockpit-store.js";

export interface StatusBarProps {
  connected: boolean;
  cwd: string;
  holoState: HoloState;
  model: string;
  runId: string | null;
}

export function StatusBar({ connected, cwd, holoState, model, runId }: StatusBarProps): React.ReactElement {
  const connColor = connected ? "green" : "red";
  const connIcon = connected ? "●" : "○";

  const shortCwd = cwd.length > 30 ? "..." + cwd.slice(-27) : cwd;
  const shortRun = runId ? `run:${runId.slice(-8)}` : "no active run";

  return (
    <Box marginTop={1}>
      <Text color={connColor}>{connIcon}</Text>
      <Text dimColor> │ </Text>
      <Text color="cyan">{shortCwd}</Text>
      <Text dimColor> │ </Text>
      <Text color="blue">{holoState.toLowerCase()}</Text>
      <Text dimColor> │ </Text>
      <Text color="magenta">{model}</Text>
      <Text dimColor> │ </Text>
      <Text dimColor>{shortRun}</Text>
    </Box>
  );
}
