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
 *   reported done with a short completion line, and the step that
 *   actually failed — the closing summary — is named in the run
 *   record (failureContributors), never dumped into the chat text.
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

/**
 * ACC-05 item 1 — the ONE primary failure reason a failed run reports
 * in its work log. The loop records every failure it observes
 * (failureContributors in observation order, plus the loop-ending
 * modelFailed / failedHonestly strings), but until now none of it
 * reached the persisted message: the route kept only the failed
 * STATUS, so the transcript could only print "Failed — no work
 * completed" even when the loop knew exactly what died (Acceptance
 * Run 1 on 8935b2a9 — a first build failed after its approval with no
 * detail anywhere). Contributors are already sanitized at their
 * sources; the result is still bounded to one short line here.
 */
export function primaryFailureReason(
  result:
    | {
        failureContributors?: readonly RunFailureContributor[];
        modelFailed?: string;
        failedHonestly?: string;
      }
    | null
    | undefined,
): string | null {
  if (!result) return null;
  const first = result.failureContributors?.[0];
  let raw: string | null = null;
  if (first) {
    raw = first.kind === "tool_failure" && first.toolId
      ? `${first.toolId}: ${first.detail}`
      : first.detail;
  } else if (result.modelFailed) {
    raw = result.modelFailed;
  } else if (result.failedHonestly) {
    raw = result.failedHonestly;
  }
  if (!raw) return null;
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > 200 ? `${oneLine.slice(0, 197)}...` : oneLine;
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
 * The user-facing text for a completed-with-warning settlement.
 *
 * Larry's mobile-chat bar (2026-11-19, reaffirmed 2026-11-20 after the
 * live "Make a pic of bike" run): short answers, no internal steps, no
 * provider/model names or HTTP codes in the visible message. The
 * previous text narrated the run's internals — "the changes were made
 * and passed the quality gate", a workspace-change count, verified
 * file lists, and a paragraph about the closing summary step — which
 * reads as an error dump in chat and falsely frames a simple media
 * request as a code change. All of that detail stays in the run
 * record (failureContributors); the user just sees that the request
 * completed. The deliverable itself (image markdown, file links) is
 * appended to the final text by the loop, so this line stays generic
 * across request types.
 */
const COMPLETED_WITH_WARNING_USER_TEXT =
  "Done — your request is complete, and the result is in your project.";

export function settleRunOutcome(input: RunSettlementInput): RunSettlement {
  const failureContributors = collectFailureContributors(input);
  if (input.cancelled) {
    return { outcome: "cancelled", failureContributors };
  }
  if (input.modelFailed && !input.failedHonestly && deliverableSucceeded(input)) {
    return {
      outcome: "completed",
      completedWithWarning: COMPLETED_WITH_WARNING_USER_TEXT,
      failureContributors,
    };
  }
  if (input.modelFailed || input.failedHonestly) {
    return { outcome: "failed", failureContributors };
  }
  return { outcome: "completed", failureContributors };
}
