/**
 * finalizeMissionRun — the ONE place a mission reaches a terminal state.
 *
 * Terminal truth contract:
 *   - termination "cancelled" → mission cancelled, no verification judged
 *   - verification.proven   → mission complete (read-only missions get
 *                             inspection steps marked passed first)
 *   - anything else         → mission failed; working/verifying steps are
 *                             failed with the real reason, pending steps
 *                             stay pending — never "passed without evidence"
 */

import type { RuntimeStore, VerificationResult } from "@litt/agent-core";
import type { AgentLoopResult } from "@litt/agent-core";
import { isSynthesisStep, markInspectionStepsComplete } from "./mission-verification.js";

export interface FinalizeMissionRunArgs {
  store: RuntimeStore;
  termination: AgentLoopResult["termination"];
  verification: VerificationResult | null;
  readOnly: boolean;
}

export interface FinalizeMissionRunResult {
  outcome: "complete" | "failed" | "cancelled";
  summary: string;
}

/**
 * Mark trailing synthesis/verify steps of a MUTATING mission as passed
 * once the VerificationGate has proven the run.
 *
 * Why this exists: completeMission() requires every step terminal, and
 * tolerates a still-"working" step only when it carries an explicit
 * verify contract (allowedActionScope "verify" or requiredEvidence
 * "verification_result"). Local-model planners routinely emit the
 * final "Verify …" step with EMPTY scope and contract — the step's work
 * was literally performed by the gate that just proved, so leaving it
 * "working" makes completeMission refuse and strands the mission at
 * "verifying" while the UI already shows COMPLETE.
 *
 * Conservative by construction: only steps isSynthesisStep() accepts
 * (report/verify/plan/summarize/design/propose/conclude/present/
 * deliver titles or scopes) AND only when they declare no requiredEvidence
 * of their own are touched. A mutating step with a real evidence
 * contract is never auto-passed — its contract must be met by evidence.
 */
async function markSynthesisStepsPassed(
  store: RuntimeStore,
  reason: string,
): Promise<void> {
  const mission = store.getMission();
  if (!mission) return;
  for (const step of mission.steps) {
    const hasOwnEvidenceContract =
      Array.isArray(step.requiredEvidence) && step.requiredEvidence.length > 0;
    if (hasOwnEvidenceContract || !isSynthesisStep(step)) continue;
    if (step.status === "pending" || step.status === "failed") {
      await store.updateMissionStepStatus(step.id, "working").catch(() => {});
    }
    if (step.status === "working" || step.status === "verifying") {
      await store.updateMissionStepStatus(step.id, "passed", {
        verificationPassed: true,
        verificationEvidence: reason.slice(0, 500),
      }).catch(() => {});
    }
  }
}

export async function finalizeMissionRun(
  args: FinalizeMissionRunArgs,
): Promise<FinalizeMissionRunResult> {
  const { store, termination, verification, readOnly } = args;

  if (termination === "cancelled") {
    const summary = "Cancelled by user";
    await store.cancelMission(summary).catch(() => {});
    return { outcome: "cancelled", summary };
  }

  const mission = store.getMission();

  if (verification?.proven) {
    const summary = verification.message;
    if (readOnly) {
      await markInspectionStepsComplete(
        store,
        `Inspection verified: ${summary.slice(0, 120)}`,
      );
    } else {
      await markSynthesisStepsPassed(
        store,
        `Verification proved: ${summary.slice(0, 120)}`,
      );
    }
    await store.completeMission(
      `Verified by VerificationGate: ${summary.slice(0, 200)}`,
      summary,
    );
    // completeMission() refuses SILENTLY when a step remains
    // non-terminal — returning "complete" here anyway would show the
    // operator COMPLETE while the persisted mission stays "verifying"
    // forever (and resurrects on restart). Verify the transition
    // actually landed; if it did not, fail honestly with the reason.
    const after = store.getMission();
    if (after?.status === "complete") {
      return { outcome: "complete", summary };
    }
    const stuck = (after?.steps ?? [])
      .filter((s) => s.status !== "passed" && s.status !== "skipped")
      .map((s) => `${s.title} (${s.status})`)
      .join(", ");
    const reason = `Verification proved but mission steps incomplete: ${stuck || "unknown"}`;
    for (const step of after?.steps ?? []) {
      if (step.status === "working" || step.status === "verifying") {
        await store.updateMissionStepStatus(step.id, "failed", {
          failureReason: reason.slice(0, 300),
          verificationPassed: false,
          verificationEvidence: reason.slice(0, 500),
        }).catch(() => {});
      }
    }
    await store.failMission(
      `Mission not completed: ${reason.slice(0, 200)}`,
      reason,
    );
    return { outcome: "failed", summary: reason };
  }

  const summary =
    verification?.message ??
    `Mission ended without verification (${termination})`;

  // Steps still in flight are failed with the real reason; pending
  // steps stay pending — a step never shows "passed" without evidence.
  for (const step of mission?.steps ?? []) {
    if (step.status === "working" || step.status === "verifying") {
      await store.updateMissionStepStatus(step.id, "failed", {
        failureReason: summary.slice(0, 300),
        verificationPassed: false,
        verificationEvidence: summary.slice(0, 500),
      }).catch(() => {});
    }
  }

  await store.failMission(
    `Verification not proven: ${summary.slice(0, 200)}`,
    summary,
  );
  return { outcome: "failed", summary };
}
