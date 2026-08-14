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
import { COLORS } from "./colors.js";

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
  const localColor = localRuntime === "ready" ? COLORS.success : localRuntime === "error" ? COLORS.error : COLORS.warning;
  const localLabel = localRuntime === "ready" ? "READY" : localRuntime === "error" ? "ERROR" : "STARTING";

  const shortRoot = projectRoot.length > 45 ? "..." + projectRoot.slice(-42) : projectRoot;

  // Compact mode — single-line header for small terminals
  if (compact) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={COLORS.brand}>⚡ LiTT</Text>
          <Text dimColor>  {project}  </Text>
          <Text color={COLORS.warning}>{branch}</Text>
          <Text dimColor>  </Text>
          <Text color={localColor}>{localIcon} LOCAL</Text>
        </Box>
        <Text dimColor>────────────────────────────────────────────────────────────</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Brand line */}
      <Box>
        <Text bold color={COLORS.brand}>⚡ LiTT CODE</Text>
        <Text dimColor>  </Text>
        <Text color={COLORS.working} dimColor>BUILD</Text>
        <Text dimColor> • </Text>
        <Text color={COLORS.working} dimColor>DEBUG</Text>
        <Text dimColor> • </Text>
        <Text color={COLORS.working} dimColor>TEST</Text>
        <Text dimColor> • </Text>
        <Text color={COLORS.working} dimColor>SHIP</Text>
      </Box>

      {/* Separator */}
      <Text dimColor>────────────────────────────────────────────────────────────</Text>

      {/* Project + Branch on one line */}
      <Box>
        <Text dimColor bold>PROJECT </Text>
        <Text color={COLORS.working} bold>{project}</Text>
        <Text dimColor>   </Text>
        <Text dimColor bold>BRANCH </Text>
        <Text color={COLORS.warning}>{branch}</Text>
      </Box>

      {/* Brain + Active on one line */}
      <Box>
        <Text dimColor bold>BRAIN   </Text>
        <Text color={COLORS.brand} bold>{brain}</Text>
        <Text dimColor>  Ctrl+M</Text>
        <Text dimColor>   </Text>
        <Text dimColor bold>ACTIVE </Text>
        <Text color={activeModel ? COLORS.info : COLORS.secondary}>
          {activeModel ?? "Waiting"}
        </Text>
      </Box>

      {/* Provider + Mode + Local on one line (Cloud is in status bar) */}
      <Box>
        <Text dimColor bold>PROVIDER </Text>
        <Text color={COLORS.working} dimColor>{source}</Text>
        <Text dimColor>   </Text>
        <Text dimColor bold>MODE </Text>
        <Text color={COLORS.brand}>{mode.toUpperCase()}</Text>
        <Text dimColor>   </Text>
        <Text color={localColor}>{localIcon} {localLabel}</Text>
      </Box>

      <Text dimColor>────────────────────────────────────────────────────────────</Text>
    </Box>
  );
}
