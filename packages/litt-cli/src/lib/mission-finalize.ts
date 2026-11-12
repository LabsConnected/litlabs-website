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

import type { AgentLoopResult, RuntimeStore, VerificationResult } from "@litt/agent-core";
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

/**
 * Evidence types the VerificationGate itself proves when it reports
 * `proven`. A step contract demanding test_result is satisfied by the
 * gate's own successful `test` check — the runtime ran the real suite,
 * which is stronger proof than whichever tool the model happened to
 * pick (project.run "npm test" produces command_result, not
 * test_result, and used to fail missions whose verification passed).
 * Skipped/failed checks prove nothing and never satisfy a contract.
 */
const GATE_CHECK_TO_EVIDENCE: Readonly<Record<string, string>> = {
  typecheck: "typecheck_result",
  test: "test_result",
  build: "build_result",
};

function gateProvenEvidenceTypes(
  verification: VerificationResult,
): ReadonlySet<string> {
  const proven = new Set<string>(["verification_result"]);
  for (const check of verification.checks) {
    if (!check.success) continue;
    const type = GATE_CHECK_TO_EVIDENCE[check.id];
    if (type) proven.add(type);
  }
  return proven;
}

/**
 * Pass NON-synthesis steps of a proven MUTATING mission whose work is
 * evidenced — the counterpart to markSynthesisStepsPassed.
 *
 * Why this exists: progressMissionStepAfterTool deliberately never
 * advances the LAST working step ("the gate/loop-end owns completion"),
 * and steps with empty requiredEvidence advance only when a LATER
 * pending step exists. So a single-step mission — or the final action
 * step of a template — always reaches finalize still "working" even
 * though its tool calls succeeded and the gate proved the run.
 * completeMission() then refuses and the mission fails despite the
 * work being done and verified (live repro: notes.txt written + tests
 * PASS, mission reported failed).
 *
 * Truth rules (same bar the gate's uncovered-step check uses):
 *   - Steps WITH requiredEvidence pass only when every required type is
 *     proven — either by successful attributed evidence for that step,
 *     or by a successful VerificationGate check of the matching kind
 *     (gateProven). An unmet contract still blocks completion.
 *   - Steps that were actually worked (working/verifying/failed) pass
 *     only when they have >=1 successful evidence record attributed to
 *     them (e.stepId === step.id && e.success) — inspection evidence
 *     counts, matching uncoveredMissionSteps.
 *   - Never-worked pending/failed steps pass only when they declare no
 *     evidence contract — same semantics as markInspectionStepsComplete
 *     for the read-only path; the gate's proof covers bookkeeping steps.
 *   - A working/verifying step with NO successful attributed evidence
 *     is never passed — its work is unproven and must block completion.
 */
async function markWorkedMissionStepsPassed(
  store: RuntimeStore,
  reason: string,
  gateProven: ReadonlySet<string> = new Set(),
): Promise<void> {
  const mission = store.getMission();
  if (!mission) return;
  for (const step of mission.steps) {
    if (step.status === "passed" || step.status === "skipped") continue;
    if (isSynthesisStep(step)) continue; // handled by markSynthesisStepsPassed

    const hasContract =
      Array.isArray(step.requiredEvidence) && step.requiredEvidence.length > 0;
    const contractMet =
      !hasContract ||
      (step.requiredEvidence ?? []).every(
        (type) =>
          gateProven.has(type) ||
          mission.evidence.some(
            (e) => e.stepId === step.id && e.type === type && e.success === true,
          ),
      );
    if (!contractMet) continue;

    const workedEvidence = mission.evidence.some(
      (e) => e.stepId === step.id && e.success === true,
    );
    // Only never-started PENDING steps may pass without worked evidence.
    // A FAILED step needs real successful evidence — failed attempts
    // alone must never be laundered into a pass.
    const neverWorked = !workedEvidence && step.status === "pending";
    if (!workedEvidence && !neverWorked) continue;
    if (neverWorked && hasContract) continue;

    if (step.status === "pending" || step.status === "failed") {
      await store.updateMissionStepStatus(step.id, "working").catch(() => {});
    }
    const current = store.getMission()?.steps.find((s) => s.id === step.id);
    if (current?.status === "working" || current?.status === "verifying") {
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
      await markWorkedMissionStepsPassed(
        store,
        `Verification proved: ${summary.slice(0, 120)}`,
        gateProvenEvidenceTypes(verification),
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
