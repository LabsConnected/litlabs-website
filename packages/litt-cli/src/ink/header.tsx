/**
 * Header — the one-line LiTT brand band.
 *
 * ```
 *   ⚡ LiTT                              ● LOCAL  ● REMOTE
 *   ⚡ LiTT                    ● SIGNED OUT
 *   ⚡ LiTT            ● LOCAL · user@email.com
 *   ⚡ LiTT            ● REMOTE · user@email.com
 *   ⚡ LiTT            ● REMOTE↻ · user@email.com
 * ```
 *
 * The header ONLY brands the surface. Project, branch, model, and
 * runtime state live in the status bar — never duplicated. The LOCAL
 * and REMOTE indicators are independent truth sources — LOCAL is always
 * available (RuntimeSession), REMOTE reflects the actual transport
 * connection state to terminal-server. On narrow terminals the
 * indicators drop off.
 *
 * Auth state (email) is shown when the user is signed in. When signed
 * out, a SIGNED OUT indicator replaces the runtime indicators.
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
        <Text bold color={COLORS.brand}>⚡ LiTT</Text>
        {width >= 50 && (
          <Text color={COLORS.error}>● SIGNED OUT</Text>
        )}
      </Box>
    );
  }

  // ─── LOCAL indicator (always available — RuntimeSession) ──────────
  const localIcon = localRuntime === "ready" ? "●" : localRuntime === "error" ? "✗" : "○";
  const localColor = localRuntime === "ready" ? COLORS.success
    : localRuntime === "error" ? COLORS.error : COLORS.warning;
  const localLabel = localRuntime === "ready" ? "LOCAL"
    : localRuntime === "error" ? "LOCAL ERR" : "LOCAL…";

  // ─── REMOTE indicator (reflects actual transport connection state) ──
  // Only shown when remote is not "offline" (i.e. when --remote was used
  // or a RuntimeClient was created). When offline, the indicator is
  // omitted entirely — LOCAL is the only active runtime.
  // Do NOT claim REMOTE until the remote runtime connection is actually
  // established (connected). Connecting/reconnecting shows the ↻ suffix.
  const showRemote = remoteRuntime !== "offline";
  const remoteIcon = remoteRuntime === "connected" ? "●"
    : remoteRuntime === "error" ? "✗" : "○";
  const remoteColor = remoteRuntime === "connected" ? COLORS.success
    : remoteRuntime === "error" ? COLORS.error : COLORS.warning;
  const remoteLabel = remoteRuntime === "connected" ? "REMOTE"
    : remoteRuntime === "connecting" ? "REMOTE…"
    : remoteRuntime === "reconnecting" ? "REMOTE↻"
    : remoteRuntime === "error" ? "REMOTE ERR" : "REMOTE";

  // ─── Email suffix — shown when signed in (e.g. "· user@email.com") ──
  // Truncated on narrow terminals to avoid wrapping.
  const emailSuffix = authEmail
    ? ` · ${authEmail.length > 25 ? authEmail.slice(0, 22) + "…" : authEmail}`
    : "";
  const showEmail = width >= 70 && !!authEmail;

  // Build the right-side indicator block
  // Priority: REMOTE (if connected/connecting) > LOCAL
  // Email is appended to whichever indicator is shown
  const primaryIndicator = showRemote
    ? <Text color={remoteColor} dimColor={remoteRuntime === "connected"}>{remoteIcon} {remoteLabel}{showEmail && emailSuffix}</Text>
    : <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}{showEmail && emailSuffix}</Text>;

  return (
    <Box justifyContent="space-between">
      <Text bold color={COLORS.brand}>⚡ LiTT</Text>
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
