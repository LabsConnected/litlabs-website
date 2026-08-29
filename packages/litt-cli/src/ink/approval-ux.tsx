/**
 * ApprovalUX — human decision interface for gateway approval requests.
 *
 * Rendered PINNED directly above the composer (never buried in the
 * transcript scroll), so a pending approval is always actionable no
 * matter where the user has scrolled.
 *
 * While this is pending the shell is BLOCKED, not working — the footer
 * shows "⚠ Waiting for your approval", never "◉ Working".
 *
 * CRITICAL INVARIANT:
 *   The UI only returns a boolean (+ scope). It must NEVER manufacture
 *   a VerifiedApproval. The gateway remains responsible for:
 *     human decision → verifyApproval() → VerifiedApproval → capsule.approval
 *
 * Keys (approval owns ALL keyboard input while pending):
 *   [a]   — Approve once
 *   [⇧A]  — Approve similar (command class, this session; never dangerous)
 *   [d]   — Deny
 *   [Esc] — Deny AND cancel/stop the active mission (fail closed)
 *
 * Enter is deliberately unbound — accidental approval must be impossible.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEscape } from "./keyboard-utils.js";
import { COLORS } from "./colors.js";
import { riskBadge, formatDuration } from "./runtime-state.js";
import type { ApprovalPrompt } from "./cockpit-store.js";

export type ApprovalDecisionScope = "once" | "session";

export interface ApprovalUXProps {
  prompt: ApprovalPrompt;
  onDecision: (approved: boolean, scope: ApprovalDecisionScope) => void;
  /** Esc — deny the approval AND cancel the active mission. */
  onCancelMission?: () => void;
}

/** Badge color — loud only for genuinely dangerous states. */
function badgeColor(label: string): string {
  switch (label) {
    case "READ": return COLORS.success;
    case "WRITE": return COLORS.gold;
    case "DEPLOY": return COLORS.warning;
    default: return COLORS.error;
  }
}

export function ApprovalUX({ prompt, onDecision, onCancelMission }: ApprovalUXProps): React.ReactElement {
  // Approval wait timer — paused, per-second, ONLY while pending.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const waitSeconds = Math.max(0, Math.floor((Date.now() - prompt.since) / 1000));

  // Register as keyboard owner — takes ALL keyboard events when active.
  // Priority over the composer: the composer is disabled while blocked,
  // and printable keys route ONLY to the top overlay owner.
  useOverlayKeyboard("approval", useCallback((input, key) => {
    if (input === "a") {
      onDecision(true, "once");
    } else if (input === "A") {
      onDecision(true, "session");
    } else if (input === "d" || input === "D") {
      onDecision(false, "once");
    } else if (isEscape(key, input)) {
      // Esc = deny + stop the mission. Fail closed, always.
      onCancelMission?.();
    }
  }, [onDecision, onCancelMission]));

  const badge = riskBadge(prompt.risk);
  const badgeCol = badgeColor(badge);
  const queued = prompt.depth > 1 ? prompt.depth - 1 : 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLORS.gold}
      paddingX={2}
      paddingY={1}
    >
      <Box justifyContent="space-between">
        <Text color={COLORS.gold} bold>⚠ APPROVAL REQUIRED</Text>
        <Text color={COLORS.gold}>waiting {formatDuration(waitSeconds)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{`${prompt.toolId}  `}</Text>
        <Text color={COLORS.textBright}>{`$ ${prompt.action}`}</Text>
      </Box>
      <Box>
        <Text color={badgeCol} bold>[{badge}]</Text>
        <Text dimColor> · scope: </Text>
        <Text color={COLORS.secondary}>{prompt.scope}</Text>
        {queued > 0 && (
          <Text color={COLORS.gold}>{` · ${queued} more queued`}</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.success} bold>[a]</Text>
        <Text> Approve once   </Text>
        <Text color={COLORS.success} bold>[⇧a]</Text>
        <Text> Approve similar   </Text>
        <Text color={COLORS.error} bold>[d]</Text>
        <Text> Deny   </Text>
        <Text color={COLORS.gold} bold>[esc]</Text>
        <Text> Cancel mission</Text>
      </Box>
    </Box>
  );
}
