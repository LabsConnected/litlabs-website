/**
 * Run settlement — the single decision for how an agent-loop run ends.
 *
 * Round-11 diagnosis Q3: the outcome used to be
 * `modelFailed || failedHonestly ? "failed" : "completed"`, computed
 * inline at each loop's tail. That made a POST-DELIVERABLE wrap-up
 * failure indistinguishable from a run that did nothing: in the
 * 2026-11-16 lion proof the image generated, saved into the project,
 * and passed the quality gate — then the closing model call exhausted
 * its routes (Gemini 429 + a dead OpenRouter env entry), and the whole
 * run settled "failed" with text claiming the request could not be
 * completed. The genuine tool defect in the same run (a redundant
 * image.saveAsset call) left no trace in the record at all.
 *
 * This module settles from the run's own evidence:
 *
 * - The deliverable counts as DONE when at least one mutation succeeded
 *   AND the quality gate passed (or no gate ran for this run).
 * - A model/route failure that arrives when the deliverable is already
 *   done settles the run COMPLETED WITH A WARNING: the work is
 *   reported done, and the text names the step that actually failed —
 *   the closing summary — instead of blaming the request.
 * - EVERY failure contributor is recorded on the settlement (failed
 *   tool calls, unknown workspace verification, honest loop failure,
 *   model/route failure), whether or not it decided the outcome, so a
 *   capacity failure can no longer mask a tool defect in the record.
 * - An honest loop failure (failedHonestly) is never upgraded: it
 *   names a defect in the work itself, not a wrap-up casualty.
 */

import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";

export interface RunFailureContributor {
  kind: "model_routes" | "tool_failure" | "verification_unknown" | "honest_failure";
  /** Set for tool_failure contributors. */
  toolId?: string;
  /** Sanitized, user-record-safe detail (tool summaries and loop
   *  failure strings are already sanitized at their sources). */
  detail: string;
}

export interface RunSettlement {
  outcome: "completed" | "failed" | "cancelled";
  /**
   * Set when the run settled completed DESPITE a model/route failure:
   * the deliverable had already landed, so the failure is a warning
   * about the closing summary step, not the run's verdict. Carries the
   * honest user-facing text for that state.
   */
  completedWithWarning?: string;
  /** Every failure observed during the run, in observation order. */
  failureContributors: RunFailureContributor[];
}

export interface RunSettlementToolCall {
  toolId: string;
  success: boolean;
  summary: string;
  mutating: boolean;
}

export interface RunSettlementInput {
  cancelled: boolean;
  /** Sanitized model-failure detail, set when a model call ended the loop. */
  modelFailed?: string;
  /** Honest loop failure (the work itself is not done) — never upgraded. */
  failedHonestly?: string;
  toolCalls: readonly RunSettlementToolCall[];
  /** Quality verdict when a gate ran; null when no gate ran. */
  qualityVerdictOk: boolean | null;
  workspaceChange?: WorkspaceChangeEvidence;
}

const MAX_TOOL_FAILURE_CONTRIBUTORS = 10;

export function collectFailureContributors(
  input: Pick<RunSettlementInput, "toolCalls" | "workspaceChange" | "failedHonestly" | "modelFailed">,
): RunFailureContributor[] {
  const contributors: RunFailureContributor[] = [];
  for (const call of input.toolCalls) {
    if (call.success) continue;
    if (contributors.filter((c) => c.kind === "tool_failure").length >= MAX_TOOL_FAILURE_CONTRIBUTORS) break;
    contributors.push({
      kind: "tool_failure",
      toolId: call.toolId,
      detail: call.summary || `${call.toolId} failed`,
    });
  }
  if (input.workspaceChange?.status === "unknown") {
    contributors.push({
      kind: "verification_unknown",
      detail:
        input.workspaceChange.unknownReason ??
        "The workspace change could not be verified.",
    });
  }
  if (input.failedHonestly) {
    contributors.push({ kind: "honest_failure", detail: input.failedHonestly });
  }
  if (input.modelFailed) {
    contributors.push({ kind: "model_routes", detail: input.modelFailed });
  }
  return contributors;
}

/** The run's requested work is done: a mutation landed and the gate passed. */
export function deliverableSucceeded(input: RunSettlementInput): boolean {
  const mutationLanded = input.toolCalls.some((c) => c.success && c.mutating);
  if (!mutationLanded) return false;
  // A verified-unchanged workspace contradicts the success flags: the
  // claimed mutation never persisted, so "complete" would be a false claim.
  if (input.workspaceChange?.status === "unchanged") return false;
  return input.qualityVerdictOk === null || input.qualityVerdictOk === true;
}

/**
 * Deterministic closing summary built from verified execution evidence.
 * Used when the model's own summary call failed, so the user still gets
 * the facts (what completed, which files the diff confirmed) without a
 * provider error dump. Never asserts more than the evidence supports:
 * file names only appear when the workspace diff actually reported them.
 */
function describeVerifiedWork(input: RunSettlementInput): string {
  const mutations = input.toolCalls.filter((c) => c.success && c.mutating);
  const files = input.workspaceChange?.files ?? [];
  const fileClause =
    files.length > 0
      ? ` Verified changes: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5} more)` : ""}.`
      : "";
  const persistedClause =
    input.workspaceChange?.status === "changed"
      ? " The workspace diff confirms the changes persisted."
      : "";
  return `${mutations.length} workspace change(s) completed successfully.${fileClause}${persistedClause}`;
}

export function settleRunOutcome(input: RunSettlementInput): RunSettlement {
  const failureContributors = collectFailureContributors(input);
  if (input.cancelled) {
    return { outcome: "cancelled", failureContributors };
  }
  if (input.modelFailed && !input.failedHonestly && deliverableSucceeded(input)) {
    const gateClause =
      input.qualityVerdictOk === true ? " and passed the quality gate" : "";
    return {
      outcome: "completed",
      completedWithWarning:
        `The requested work is complete — the changes were made${gateClause}. ` +
        `${describeVerifiedWork(input)} ` +
        `The only step that failed was the closing summary: the AI model call for the final reply ` +
        `could not complete, so this run ends without a written summary. ` +
        `The completed work is in the project and is not affected.`,
      failureContributors,
    };
  }
  if (input.modelFailed || input.failedHonestly) {
    return { outcome: "failed", failureContributors };
  }
  return { outcome: "completed", failureContributors };
}
