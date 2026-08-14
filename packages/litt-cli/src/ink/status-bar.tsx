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
  localRuntime: string;
  remoteRuntime: string;
  cwd: string;
  holoState: HoloState;
  model: string;
  runId: string | null;
}

export function StatusBar({ connected, localRuntime, remoteRuntime, cwd, holoState, model, runId }: StatusBarProps): React.ReactElement {
  const localIcon = localRuntime === "ready" ? "●" : "○";
  const localColor = localRuntime === "ready" ? "green" : "yellow";
  const remoteIcon = remoteRuntime === "connected" ? "●" : "○";
  const remoteColor = remoteRuntime === "connected" ? "green" : "gray";

  const shortCwd = cwd.length > 30 ? "..." + cwd.slice(-27) : cwd;
  const shortRun = runId ? `run:${runId.slice(-8)}` : "no active run";

  return (
    <Box marginTop={1}>
      <Text color={localColor}>{localIcon}</Text>
      <Text dimColor> L │ </Text>
      <Text color={remoteColor}>{remoteIcon}</Text>
      <Text dimColor> R │ </Text>
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
