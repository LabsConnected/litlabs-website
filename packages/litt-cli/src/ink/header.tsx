/**
 * Header — the one-line LiTT brand band.
 *
 * ```
 *   LiTT                              ● LOCAL  ● TOOLS
 *   LiTT                              ● REMOTE  ● TOOLS
 *   LiTT                    ● SIGNED OUT
 *   LiTT            ● REMOTE↻  ● TOOLS
 * ```
 *
 * The header ONLY brands the surface. Project, branch, model, and
 * runtime state live in the status bar — never duplicated.
 *
 * The primary badge reflects the CONFIGURED execution target:
 *   - executionTarget === "local"  → ● LOCAL (never REMOTE, even if
 *     remote transport happens to be connected)
 *   - executionTarget === "remote" → actual remote transport state
 *     (● REMOTE / ○ REMOTE… / ✗ REMOTE ERR)
 *
 * The secondary badge shows local TOOL availability (● TOOLS), which is
 * independent of the execution target — local tooling stays ready even
 * while model calls execute remotely.
 *
 * On narrow terminals the indicators drop off.
 *
 * Auth state is NOT shown in the header by default — email is private.
 * Use /whoami, /account, or /doctor --verbose for full identity.
 * When signed out, a SIGNED OUT indicator replaces the runtime indicators.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import { deriveTransport } from "../lib/transport-projection.js";
import type { ExecutionTarget } from "../lib/execution-target.js";

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
  /**
   * The CONFIGURED execution target (see lib/execution-target.ts) —
   * where the cockpit intends model calls to run.
   *
   * This IS rendered as the primary badge:
   *   - "local"  → ● LOCAL (never REMOTE, even if remote transport is
   *     connected — a connected transport is not the same as being the
   *     active execution target)
   *   - "remote" → actual remote transport state from deriveTransport
   */
  executionTarget: ExecutionTarget;
  localRuntime: string;
  remoteRuntime: string;
  mode: string;
  /** Auth email — shown when signed in (null when signed out or unknown). */
  authEmail?: string | null;
  /** Whether the user is signed in. When false, shows SIGNED OUT. */
  signedIn?: boolean;
  /** Compact mode for small terminals (ignored — the header is always one line). */
  compact?: boolean;
}

export function Header({
  executionTarget,
  localRuntime,
  remoteRuntime,
  authEmail,
  signedIn,
}: HeaderProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  // ─── SIGNED OUT state — takes priority over runtime indicators ───
  // When signed out, the header shows ● SIGNED OUT instead of LOCAL/REMOTE.
  // This is the truthful state: the cockpit is only mounted after auth,
  // but this covers the edge case where auth state changes during a session.
  if (signedIn === false) {
    return (
      <Box justifyContent="space-between">
        <Text bold color={COLORS.brand}>LiTT</Text>
        {width >= 50 && (
          <Text color={COLORS.error}>● SIGNED OUT</Text>
        )}
      </Box>
    );
  }

  // ─── Transport projection (SHARED with the status bar) ────────────
  // Both surfaces render from this ONE derivation, so the header and the
  // footer cannot assert different transports at the same moment.
  const transport = deriveTransport({ localRuntime, remoteRuntime, signedIn });

  // Secondary indicator: local TOOL availability. Labelled TOOLS, not
  // LOCAL — it reports whether local tooling is ready, which is true
  // regardless of whether execution is happening remotely.
  const localIcon = transport.footerSeverity === "ok" ? "●"
    : transport.footerSeverity === "error" ? "✗" : "○";
  const localColor = transport.footerSeverity === "ok" ? COLORS.success
    : transport.footerSeverity === "error" ? COLORS.error : COLORS.warning;
  const localLabel = transport.footerLabel;

  // ─── Primary indicator: the CONFIGURED execution target ───────────
  //
  // executionTarget answers "what WILL this cockpit use for model calls?"
  // remoteRuntime answers "is the remote transport connected right now?"
  // These are DIFFERENT questions and must not be confused.
  //
  // When executionTarget === "local" (LITT_LOCAL_MODE=1):
  //   - The primary badge is ALWAYS "● LOCAL"
  //   - A connected remote transport must NOT override the LOCAL label
  //   - Local tooling may additionally show "● TOOLS"
  //   - The remote transport may exist (for future use) but is NOT the
  //     active execution target, so it is never shown as primary
  //
  // When executionTarget === "remote":
  //   - The badge reflects the ACTUAL remote connection state:
  //     ● REMOTE / ○ REMOTE… / ✗ REMOTE ERR
  //   - Local TOOLS may show as a secondary indicator
  if (executionTarget === "local") {
    // Local-only mode: primary badge is LOCAL, never REMOTE
    const localPrimaryIcon = localRuntime === "ready" ? "●"
      : localRuntime === "error" ? "✗" : "○";
    const localPrimaryColor = localRuntime === "ready" ? COLORS.success
      : localRuntime === "error" ? COLORS.error : COLORS.warning;
    const localPrimaryLabel = localRuntime === "ready" ? "LOCAL"
      : localRuntime === "error" ? "LOCAL ERR" : "LOCAL…";

    return (
      <Box justifyContent="space-between">
        <Text bold color={COLORS.brand}>LiTT</Text>
        {width >= 50 && (
          <Box gap={2}>
            <Text color={localPrimaryColor} dimColor={localRuntime === "ready"}>{localPrimaryIcon} {localPrimaryLabel}</Text>
            {width >= 80 && (
              <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}</Text>
            )}
          </Box>
        )}
      </Box>
    );
  }

  // executionTarget === "remote": show actual remote transport state
  const showRemote = transport.showRemote;
  const remoteIcon = transport.remoteActive ? "●"
    : transport.headerSeverity === "error" ? "✗" : "○";
  const remoteColor = transport.headerSeverity === "ok" ? COLORS.success
    : transport.headerSeverity === "error" ? COLORS.error : COLORS.warning;
  const remoteLabel = transport.headerLabel;

  // Build the right-side indicator block
  // Priority: REMOTE (if connected/connecting) > TOOLS
  const primaryIndicator = showRemote
    ? <Text color={remoteColor} dimColor={remoteRuntime === "connected"}>{remoteIcon} {remoteLabel}</Text>
    : <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}</Text>;

  return (
    <Box justifyContent="space-between">
      <Text bold color={COLORS.brand}>LiTT</Text>
      {width >= 50 && (
        <Box gap={2}>
          {primaryIndicator}
          {showRemote && width >= 80 && (
            <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
