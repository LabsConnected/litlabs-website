/**
 * StatusBar — bottom status bar with runtime state + keyboard help.
 *
 * Uses Local/Cloud semantics (not Local/Remote).
 * Cloud being offline is normal — local execution is the default.
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

export function StatusBar({
  connected, localRuntime, remoteRuntime, cwd, holoState, brain, activeModel, runId,
}: StatusBarProps): React.ReactElement {
  const localIcon = localRuntime === "ready" ? "●" : "○";
  const localColor = localRuntime === "ready" ? "green" : "yellow";
  const cloudIcon = remoteRuntime === "connected" ? "●" : "○";
  const cloudColor = remoteRuntime === "connected" ? "green" : "gray";

  const shortRun = runId ? `run:${runId.slice(-8)}` : "no active run";
  const stateColor = holoState === "RUNNING" || holoState === "THINKING" ? "cyan"
    : holoState === "SUCCESS" ? "green"
    : holoState === "FAILED" ? "red"
    : holoState === "APPROVAL" ? "yellow"
    : "gray";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>────────────────────────────────────────────────────────────</Text>
      <Box>
        <Text color={localColor}>{localIcon}</Text>
        <Text dimColor> LOCAL </Text>
        <Text color={localColor}>{localRuntime === "ready" ? "READY" : localRuntime.toUpperCase()}</Text>
        <Text dimColor>   </Text>
        <Text color={cloudColor}>{cloudIcon}</Text>
        <Text dimColor> CLOUD </Text>
        <Text color={cloudColor}>{remoteRuntime === "connected" ? "CONNECTED" : "NOT CONNECTED"}</Text>
        <Text dimColor>   </Text>
        <Text color={stateColor}>{holoState.toLowerCase()}</Text>
        <Text dimColor>   </Text>
        <Text dimColor>{shortRun}</Text>
      </Box>
      <Box>
        <Text dimColor>Brain: </Text>
        <Text color="magenta">{brain}</Text>
        {activeModel && <Text dimColor> → </Text>}
        {activeModel && <Text color="blue">{activeModel}</Text>}
      </Box>
      <Text dimColor>Ctrl+M Model · Ctrl+K Actions · Ctrl+C Cancel · Ctrl+L Clear · Esc Close</Text>
    </Box>
  );
}
