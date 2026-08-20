/**
 * Header — the one-line LiTT brand band.
 *
 * ```
 *   ⚡ LiTT                                      LOCAL
 * ```
 *
 * The header ONLY brands the surface. Project, branch, model, and
 * runtime state live in the status bar — never duplicated. The LOCAL
 * indicator is the single state dot (muted; the status bar owns the
 * details). On narrow terminals the indicator drops off.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
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
  /** Compact mode for small terminals (ignored — the header is always one line). */
  compact?: boolean;
}

export function Header({
  localRuntime,
}: HeaderProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  const localIcon = localRuntime === "ready" ? "●" : localRuntime === "error" ? "✗" : "○";
  const localColor = localRuntime === "ready" ? COLORS.success
    : localRuntime === "error" ? COLORS.error : COLORS.warning;
  const localLabel = localRuntime === "ready" ? "LOCAL"
    : localRuntime === "error" ? "LOCAL ERR" : "LOCAL…";

  return (
    <Box justifyContent="space-between">
      <Text bold color={COLORS.brand}>⚡ LiTT</Text>
      {width >= 60 && (
        <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}</Text>
      )}
    </Box>
  );
}
