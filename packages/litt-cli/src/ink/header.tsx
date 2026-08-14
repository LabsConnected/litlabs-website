/**
 * Header — project, branch, model, runtime connection.
 *
 * Reads from RuntimeClient state. No business logic.
 */

import React from "react";
import { Box, Text } from "ink";

export interface HeaderProps {
  project: string;
  projectRoot: string;
  branch: string;
  model: string;
  connected: boolean;
  localRuntime: string;
  remoteRuntime: string;
}

export function Header({ project, projectRoot, branch, model, connected, localRuntime, remoteRuntime }: HeaderProps): React.ReactElement {
  const localIcon = localRuntime === "ready" ? "●" : localRuntime === "error" ? "✗" : "○";
  const localColor = localRuntime === "ready" ? "green" : localRuntime === "error" ? "red" : "yellow";
  const localLabel = localRuntime === "ready" ? "LOCAL" : localRuntime.toUpperCase();

  const remoteIcon = remoteRuntime === "connected" ? "●" : "○";
  const remoteColor = remoteRuntime === "connected" ? "green" : "gray";
  const remoteLabel = remoteRuntime === "connected" ? "CONNECTED"
    : remoteRuntime === "connecting" ? "CONNECTING"
    : remoteRuntime === "reconnecting" ? "RECONNECTING"
    : remoteRuntime === "error" ? "ERROR"
    : "OFFLINE";

  // Shorten root path for display
  const shortRoot = projectRoot.length > 40 ? "..." + projectRoot.slice(-37) : projectRoot;

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
        <Text dimColor>Root: </Text>
        <Text dimColor>{shortRoot}</Text>
      </Box>
      <Box>
        <Text dimColor>Model: </Text>
        <Text color="blue">{model}</Text>
        <Text dimColor> │ Local: </Text>
        <Text color={localColor}>{localIcon} {localLabel}</Text>
        <Text dimColor> │ Remote: </Text>
        <Text color={remoteColor}>{remoteIcon} {remoteLabel}</Text>
      </Box>
    </Box>
  );
}
