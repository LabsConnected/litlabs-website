/**
 * Policy-aware approval handler for non-interactive `litt ask` mode.
 *
 * Instead of unconditionally returning `true`, this handler inspects the
 * risk assessment and applies a tiered policy:
 *
 *   safe / read-only         → auto-approve (no risk)
 *   elevated / scoped write  → auto-approve in ACT mode (user chose to act)
 *   dangerous / destructive  → DENY (requires explicit --yes flag or interactive UI)
 *   external_action          → DENY (git push, deployments, etc.)
 *
 * The gateway's own safety classification is the first line of defense.
 * This handler is the second — it prevents the non-interactive path from
 * ever approving something that should require a human.
 */

import type { RiskAssessment } from "@litt/agent-core";

export interface ApprovalPolicyOptions {
  /** When true, allows dangerous commands that would otherwise be denied. */
  explicitYes?: boolean;
}

/**
 * Create a policy-aware approval callback for ExecutionGateway.
 *
 * Usage:
 *   const gateway = new ExecutionGateway({
 *     ...
 *     onApprovalRequired: createPolicyApproval({ explicitYes: flags.yes }),
 *   });
 */
export function createPolicyApproval(
  options: ApprovalPolicyOptions = {},
): (request: unknown, risk: RiskAssessment | null) => Promise<boolean> {
  const { explicitYes = false } = options;

  return async (_request: unknown, risk: RiskAssessment | null): Promise<boolean> => {
    // No risk assessment — fail closed
    if (!risk) return false;

    switch (risk.level) {
      case "safe":
        // Read-only / harmless — always allow
        return true;

      case "elevated":
        // Scoped writes, arbitrary code in ACT mode — the user explicitly
        // chose act mode, so allow. In PLAN mode the gateway blocks these
        // before we even get here.
        return true;

      case "dangerous":
        // Destructive commands (rm -rf, format, kill), external actions
        // (git push, deployments). DENY in non-interactive mode unless
        // the user passed an explicit --yes flag.
        if (explicitYes && risk.capability !== "destructive") {
          // --yes allows external_action (git push) but NEVER destructive (rm -rf)
          return true;
        }
        return false;

      default:
        // Unknown risk level — fail closed
        return false;
    }
  };
}
