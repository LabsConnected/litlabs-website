/**
 * ApprovalUX — human decision interface for gateway approval requests.
 *
 * When the gateway emits approval-required state, this component
 * shows the pending action and collects the human's decision.
 *
 * CRITICAL INVARIANT:
 *   The UI only returns a boolean (approve/deny).
 *   It must NEVER manufacture a VerifiedApproval.
 *   The gateway remains responsible for:
 *     human decision → verifyApproval() → VerifiedApproval → capsule.approval
 *
 * Keys:
 *   [A] — Approve once
 *   [D] — Deny
 *   Esc — Deny (fail closed)
 */

import React, { useCallback } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEscape } from "./keyboard-utils.js";
import { COLORS } from "./colors.js";
import type { ApprovalPrompt } from "./cockpit-store.js";

export interface ApprovalUXProps {
  prompt: ApprovalPrompt;
  onDecision: (approved: boolean) => void;
}

export function ApprovalUX({ prompt, onDecision }: ApprovalUXProps): React.ReactElement {
  // Register as keyboard owner — takes ALL keyboard events when active
  useOverlayKeyboard("approval", useCallback((input, key) => {
    if (input === "a" || input === "A") {
      onDecision(true);
    } else if (input === "d" || input === "D" || isEscape(key, input)) {
      onDecision(false);
    }
  }, [onDecision]));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLORS.warning}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box>
        <Text color={COLORS.warning} bold>⚠ APPROVAL REQUIRED</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Tool:   </Text>
        <Text color={COLORS.working}>{prompt.toolId}</Text>
      </Box>
      <Box>
        <Text dimColor>Action: </Text>
        <Text color={COLORS.text}>{prompt.action}</Text>
      </Box>
      <Box>
        <Text dimColor>Risk:   </Text>
        <Text color={COLORS.warning}>{prompt.risk}</Text>
      </Box>
      <Box>
        <Text dimColor>Scope:  </Text>
        <Text color={COLORS.secondary}>{prompt.scope}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.success} bold>[A]</Text>
        <Text> Approve once  </Text>
        <Text color={COLORS.error} bold>[D]</Text>
        <Text> Deny</Text>
      </Box>
    </Box>
  );
}
