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
import { Box, Text, useInput } from "ink";
import type { ApprovalPrompt } from "./cockpit-store.js";

export interface ApprovalUXProps {
  prompt: ApprovalPrompt;
  onDecision: (approved: boolean) => void;
}

export function ApprovalUX({ prompt, onDecision }: ApprovalUXProps): React.ReactElement {
  useInput(useCallback((input, key) => {
    if (input === "a" || input === "A") {
      onDecision(true);
    } else if (input === "d" || input === "D" || key.escape) {
      onDecision(false);
    }
  }, [onDecision]));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box>
        <Text color="yellow" bold>⚠ APPROVAL REQUIRED</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Tool:   </Text>
        <Text color="cyan">{prompt.toolId}</Text>
      </Box>
      <Box>
        <Text dimColor>Action: </Text>
        <Text color="white">{prompt.action}</Text>
      </Box>
      <Box>
        <Text dimColor>Risk:   </Text>
        <Text color="yellow">{prompt.risk}</Text>
      </Box>
      <Box>
        <Text dimColor>Scope:  </Text>
        <Text color="gray">{prompt.scope}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="green" bold>[A]</Text>
        <Text> Approve once  </Text>
        <Text color="red" bold>[D]</Text>
        <Text> Deny</Text>
      </Box>
    </Box>
  );
}
