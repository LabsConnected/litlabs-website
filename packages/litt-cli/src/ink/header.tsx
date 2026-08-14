/**
 * Header — branded LiTT CODE cockpit header.
 *
 * Shows:
 *   ⚡ LiTT CODE  BUILD • DEBUG • TEST • SHIP
 *   Project context (name, branch, root)
 *   Brain / Active / Provider model display
 *   Local + Cloud runtime states
 *
 * Compact mode (small terminals) collapses to a single-line header.
 */

import React from "react";
import { Box, Text } from "ink";

export interface HeaderProps {
  project: string;
  projectRoot: string;
  branch: string;
  /** Brain label — what the user sees as "LiTT's brain" (e.g. "LiTT Auto") */
  brain: string;
  /** Active model — what the runtime actually used (null until first run) */
  activeModel: string | null;
  /** Provider source (e.g. "OpenRouter • BYOK ✓") */
  source: string;
  connected: boolean;
  localRuntime: string;
  remoteRuntime: string;
  mode: string;
  /** Compact mode for small terminals */
  compact?: boolean;
}

export function Header({
  project, projectRoot, branch, brain, activeModel, source,
  connected, localRuntime, remoteRuntime, mode, compact,
}: HeaderProps): React.ReactElement {
  const localIcon = localRuntime === "ready" ? "●" : localRuntime === "error" ? "✗" : "○";
  const localColor = localRuntime === "ready" ? "green" : localRuntime === "error" ? "red" : "yellow";
  const localLabel = localRuntime === "ready" ? "READY" : localRuntime === "error" ? "ERROR" : "STARTING";

  const cloudIcon = remoteRuntime === "connected" ? "●" : "○";
  const cloudColor = remoteRuntime === "connected" ? "green" : "gray";
  const cloudLabel = remoteRuntime === "connected" ? "CONNECTED"
    : remoteRuntime === "connecting" ? "CONNECTING"
    : remoteRuntime === "reconnecting" ? "RECONNECTING"
    : remoteRuntime === "error" ? "ERROR"
    : "NOT CONNECTED";

  const shortRoot = projectRoot.length > 45 ? "..." + projectRoot.slice(-42) : projectRoot;

  // Compact mode — single-line header for small terminals
  if (compact) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color="magenta">⚡ LiTT</Text>
          <Text dimColor>  {project}  </Text>
          <Text color="yellow">{branch}</Text>
          <Text dimColor>  </Text>
          <Text color={localColor}>{localIcon} LOCAL</Text>
          <Text dimColor>  </Text>
          <Text color={cloudColor}>{cloudIcon} CLOUD</Text>
        </Box>
        <Text dimColor>────────────────────────────────────────────────────────────</Text>
      </Box>
    );
  }

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
        <Text dimColor bold>PROJECT   </Text>
        <Text color="cyan" bold>{project}</Text>
      </Box>
      <Box>
        <Text dimColor bold>BRANCH    </Text>
        <Text color="yellow">{branch}</Text>
      </Box>
      <Box>
        <Text dimColor bold>PATH      </Text>
        <Text dimColor>{shortRoot}</Text>
      </Box>

      {/* Brain / Active / Provider — the three model concepts */}
      <Box marginTop={0}>
        <Text dimColor bold>BRAIN     </Text>
        <Text color="magenta" bold>{brain}</Text>
        <Text dimColor>  Ctrl+M</Text>
      </Box>
      <Box>
        <Text dimColor bold>ACTIVE    </Text>
        <Text color={activeModel ? "blue" : "gray"}>
          {activeModel ?? "Waiting for task"}
        </Text>
      </Box>
      <Box>
        <Text dimColor bold>PROVIDER  </Text>
        <Text color="cyan" dimColor>{source}</Text>
      </Box>

      {/* Mode + Local/Cloud status */}
      <Box>
        <Text dimColor bold>MODE      </Text>
        <Text color="magenta">{mode.toUpperCase()}</Text>
        <Text dimColor>    </Text>
        <Text dimColor bold>LOCAL   </Text>
        <Text color={localColor}>{localIcon} {localLabel}</Text>
        <Text dimColor>    </Text>
        <Text dimColor bold>CLOUD   </Text>
        <Text color={cloudColor}>{cloudIcon} {cloudLabel}</Text>
      </Box>

      <Text dimColor>────────────────────────────────────────────────────────────</Text>
    </Box>
  );
}
