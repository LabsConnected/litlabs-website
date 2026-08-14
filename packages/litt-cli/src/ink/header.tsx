/**
 * Header — branded LiTT CODE cockpit header.
 *
 * Shows:
 *   ⚡ LiTT CODE
 *   BUILD • DEBUG • TEST • SHIP
 *   Project context (name, branch, root)
 *   Model badge with [Ctrl+M Change] hint
 *   Local + Remote runtime states
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
  mode: string;
}

export function Header({ project, projectRoot, branch, model, connected, localRuntime, remoteRuntime, mode }: HeaderProps): React.ReactElement {
  const localIcon = localRuntime === "ready" ? "●" : localRuntime === "error" ? "✗" : "○";
  const localColor = localRuntime === "ready" ? "green" : localRuntime === "error" ? "red" : "yellow";
  const localLabel = localRuntime === "ready" ? "ONLINE" : localRuntime.toUpperCase();

  const remoteIcon = remoteRuntime === "connected" ? "●" : "○";
  const remoteColor = remoteRuntime === "connected" ? "green" : "gray";
  const remoteLabel = remoteRuntime === "connected" ? "CONNECTED"
    : remoteRuntime === "connecting" ? "CONNECTING"
    : remoteRuntime === "reconnecting" ? "RECONNECTING"
    : remoteRuntime === "error" ? "ERROR"
    : "OFFLINE";

  // Shorten root for display
  const shortRoot = projectRoot.length > 45 ? "..." + projectRoot.slice(-42) : projectRoot;

  return (
    <Box flexDirection="column">
      {/* Brand line */}
      <Box>
        <Text bold color="magenta">⚡ LiTT CODE</Text>
        <Text dimColor>  </Text>
        <Text color="cyan" dimColor>BUILD</Text>
        <Text dimColor> • </Text>
        <Text color="cyan" dimColor>DEBUG</Text>
        <Text dimColor> • </Text>
        <Text color="cyan" dimColor>TEST</Text>
        <Text dimColor> • </Text>
        <Text color="cyan" dimColor>SHIP</Text>
      </Box>

      {/* Separator */}
      <Text dimColor>────────────────────────────────────────────────────────────</Text>

      {/* Project context */}
      <Box>
        <Text dimColor bold>PROJECT  </Text>
        <Text color="cyan" bold>{project}</Text>
      </Box>
      <Box>
        <Text dimColor bold>BRANCH   </Text>
        <Text color="yellow">{branch}</Text>
      </Box>
      <Box>
        <Text dimColor bold>PATH     </Text>
        <Text dimColor>{shortRoot}</Text>
      </Box>

      {/* Model + mode + status */}
      <Box marginTop={0}>
        <Text dimColor bold>MODEL    </Text>
        <Text color="blue">{model}</Text>
        <Text dimColor> [Ctrl+M Change]</Text>
      </Box>
      <Box>
        <Text dimColor bold>MODE     </Text>
        <Text color="magenta">{mode.toUpperCase()}</Text>
        <Text dimColor>    </Text>
        <Text dimColor bold>STATUS   </Text>
        <Text color={localColor}>{localIcon} {localLabel}</Text>
        <Text dimColor>    </Text>
        <Text dimColor bold>REMOTE   </Text>
        <Text color={remoteColor}>{remoteIcon} {remoteLabel}</Text>
      </Box>

      <Text dimColor>────────────────────────────────────────────────────────────</Text>
    </Box>
  );
}
