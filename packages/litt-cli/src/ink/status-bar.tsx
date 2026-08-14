/**
 * StatusBar — bottom status line with runtime indicators.
 *
 * Shows local/remote indicators, cwd, holo state, model, runId,
 * and keyboard shortcut hints.
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
  brain: string;
  activeModel: string | null;
  runId: string | null;
}

export function StatusBar({ connected, localRuntime, remoteRuntime, cwd, holoState, brain, activeModel, runId }: StatusBarProps): React.ReactElement {
  const localIcon = localRuntime === "ready" ? "●" : "○";
  const localColor = localRuntime === "ready" ? "green" : "yellow";
  const remoteIcon = remoteRuntime === "connected" ? "●" : "○";
  const remoteColor = remoteRuntime === "connected" ? "green" : "gray";

  const shortCwd = cwd.length > 30 ? "..." + cwd.slice(-27) : cwd;
  const shortRun = runId ? `run:${runId.slice(-8)}` : "no active run";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>────────────────────────────────────────────────────────────</Text>
      <Box>
        <Text color={localColor}>{localIcon}</Text>
        <Text dimColor> LOCAL   </Text>
        <Text color={remoteColor}>{remoteIcon}</Text>
        <Text dimColor> REMOTE   </Text>
        <Text color="blue">{holoState.toLowerCase()}</Text>
        <Text dimColor>   </Text>
        <Text dimColor>{shortRun}</Text>
      </Box>
      <Box>
        <Text dimColor>Brain: </Text>
        <Text color="magenta">{brain}</Text>
        {activeModel && <Text dimColor> → </Text>}
        {activeModel && <Text color="blue">{activeModel}</Text>}
      </Box>
      <Text dimColor>Ctrl+M model · Ctrl+K actions · Ctrl+C cancel · Ctrl+L clear · Esc close</Text>
    </Box>
  );
}
