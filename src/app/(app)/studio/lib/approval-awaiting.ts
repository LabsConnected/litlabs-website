import type { ApprovalPhase, PendingApproval } from "../stores/useExecutionStore";

/**
 * Does this gate still await the user's decision? THE single derivation
 * every status surface must use (header pill, Mission cards, mobile build
 * bar, ambient HUD). pendingApproval intentionally STAYS mounted through
 * "submitting"/"executing" so the chat card can show "Approved —
 * running…"; surfaces that keyed off its presence alone kept announcing
 * "Approval needed / waiting" on the same screen where the card already
 * said the run had resumed (Larry's screenshot, 2026-11-11). A "failed"
 * phase means the decision never landed and the gate is still actionable,
 * so it still awaits a decision.
 *
 * Lives in its own module (type-only store import) so component test
 * harnesses that mock the execution store never have to know it exists.
 */
export function approvalAwaitingDecision(
  approval: PendingApproval | null | undefined,
  phase: ApprovalPhase,
): boolean {
  return approval != null && phase !== "submitting" && phase !== "executing";
}
