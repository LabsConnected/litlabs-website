/**
 * Header — the one-line LiTT brand band.
 *
 * ```
 *   LiTT                              ● LOCAL  ● TOOLS
 *   LiTT                              ● REMOTE  ● TOOLS
 *   LiTT                    ● LOCAL  ● SIGNED OUT
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
 * When signed out, a SIGNED OUT indicator appears as a secondary badge
 * — it does NOT suppress the LOCAL/REMOTE primary badge, because LOCAL
 * is now the default execution target and the user should see it.
 *
 * On narrow terminals the indicators drop off.
 *
 * Auth state is NOT shown in the header by default — email is private.
 * Use /whoami, /account, or /doctor --verbose for full identity.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import { deriveTransport } from "../lib/transport-projection.js";
import type { ExecutionTarget } from "../lib/execution-target.js";
import { SectionDivider, classifyWidth } from "./ui-primitives.js";
import { LiTTMark, type MarkState } from "./litt-mark.js";

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
   */
  executionTarget: ExecutionTarget;
  localRuntime: string;
  remoteRuntime: string;
  mode: string;
  /** Auth email — shown when signed in (null when signed out or unknown). */
  authEmail?: string | null;
  /** Whether the user is signed in. When false, shows SIGNED OUT as secondary. */
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
  const w = classifyWidth(width);

  // ─── Transport projection (SHARED with the status bar) ────────────
  const transport = deriveTransport({ localRuntime, remoteRuntime, signedIn });

  // Secondary indicator: local TOOL availability.
  const localIcon = transport.footerSeverity === "ok" ? "●"
    : transport.footerSeverity === "error" ? "✗" : "○";
  const localColor = transport.footerSeverity === "ok" ? COLORS.success
    : transport.footerSeverity === "error" ? COLORS.error : COLORS.warning;
  const localLabel = transport.footerLabel;

  // Build the right-side badge block based on execution target.
  // SIGNED OUT is shown as a SECONDARY badge, never suppressing the
  // primary LOCAL/REMOTE badge.
  let primaryBadge: React.ReactElement;
  let showToolsBadge = false;

  if (executionTarget === "local") {
    // LOCAL target: primary badge is always LOCAL, never REMOTE
    const localPrimaryIcon = localRuntime === "ready" ? "●"
      : localRuntime === "error" ? "✗" : "○";
    const localPrimaryColor = localRuntime === "ready" ? COLORS.success
      : localRuntime === "error" ? COLORS.error : COLORS.warning;
    const localPrimaryLabel = localRuntime === "ready" ? "LOCAL"
      : localRuntime === "error" ? "LOCAL ERR" : "LOCAL…";
    primaryBadge = (
      <Text color={localPrimaryColor} dimColor={localRuntime === "ready"}>
        {localPrimaryIcon} {localPrimaryLabel}
      </Text>
    );
    showToolsBadge = w === "wide";
  } else {
    // REMOTE target: show actual remote transport state
    const showRemote = transport.showRemote;
    const remoteIcon = transport.remoteActive ? "●"
      : transport.headerSeverity === "error" ? "✗" : "○";
    const remoteColor = transport.headerSeverity === "ok" ? COLORS.success
      : transport.headerSeverity === "error" ? COLORS.error : COLORS.warning;
    const remoteLabel = transport.headerLabel;
    primaryBadge = showRemote
      ? <Text color={remoteColor} dimColor={remoteRuntime === "connected"}>{remoteIcon} {remoteLabel}</Text>
      : <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}</Text>;
    showToolsBadge = showRemote && w === "wide";
  }

  // Determine mark state from execution target + runtime
  const markState: MarkState = executionTarget === "remote"
    ? (transport.showRemote ? "remote" : "idle")
    : "local";

  // Assemble the right-side badges
  const rightBadges: React.ReactElement[] = [];
  if (w !== "narrow") {
    rightBadges.push(primaryBadge);
    if (showToolsBadge) {
      rightBadges.push(
        <Text color={localColor} dimColor={localRuntime === "ready"}>{localIcon} {localLabel}</Text>
      );
    }
    // SIGNED OUT is a secondary indicator — shown alongside the primary badge
    if (signedIn === false) {
      rightBadges.push(
        <Text color={COLORS.error}>● SIGNED OUT</Text>
      );
    }
  }

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <LiTTMark state={markState} showWordmark={w !== "narrow"} size={w === "narrow" ? "compact" : "normal"} />
        {rightBadges.length > 0 && (
          <Box gap={2}>
            {rightBadges.map((badge, i) => (
              <React.Fragment key={i}>{badge}</React.Fragment>
            ))}
          </Box>
        )}
      </Box>
      {w !== "narrow" && <SectionDivider width={Math.min(width - 4, 72)} />}
    </Box>
  );
}
