/**
 * Header — the one-line LiTT brand band.
 *
 * ```
 *   LiTT                              ● LOCAL  ● REMOTE
 *   LiTT                    ● SIGNED OUT
 *   LiTT            ● LOCAL · user@email.com
 *   LiTT            ● REMOTE · user@email.com
 *   LiTT            ● REMOTE↻ · user@email.com
 * ```
 *
 * The header ONLY brands the surface. Project, branch, model, and
 * runtime state live in the status bar — never duplicated. The LOCAL
 * and REMOTE indicators are independent truth sources — LOCAL is always
 * available (RuntimeSession), REMOTE reflects the actual transport
 * connection state to terminal-server. On narrow terminals the
 * indicators drop off.
 *
 * Auth state is NOT shown in the header by default — email is private.
 * Use /whoami, /account, or /doctor --verbose for full identity.
 * When signed out, a SIGNED OUT indicator replaces the runtime indicators.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import { deriveTransport } from "../lib/transport-projection.js";

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
  /** Auth email — shown when signed in (null when signed out or unknown). */
  authEmail?: string | null;
  /** Whether the user is signed in. When false, shows SIGNED OUT. */
  signedIn?: boolean;
  /** Compact mode for small terminals (ignored — the header is always one line). */
  compact?: boolean;
}

export function Header({
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

  // ─── Primary indicator: the ACTUAL execution path ─────────────────
  // REMOTE is claimed only on an established connection; connecting,
  // reconnecting and error render distinct labels.
  const showRemote = transport.showRemote;
  const remoteIcon = transport.remoteActive ? "●"
    : transport.headerSeverity === "error" ? "✗" : "○";
  const remoteColor = transport.headerSeverity === "ok" ? COLORS.success
    : transport.headerSeverity === "error" ? COLORS.error : COLORS.warning;
  const remoteLabel = transport.headerLabel;

  // ─── No email in header — privacy by default ──────────────────────
  // Full identity is available via /whoami, /account, /doctor --verbose.
  // The header shows only REMOTE/TOOLS indicators, never the user's email.

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
