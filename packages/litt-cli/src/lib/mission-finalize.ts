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
import { markInspectionStepsComplete } from "./mission-verification.js";

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
    }
    await store.completeMission(
      `Verified by VerificationGate: ${summary.slice(0, 200)}`,
      summary,
    );
    return { outcome: "complete", summary };
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
