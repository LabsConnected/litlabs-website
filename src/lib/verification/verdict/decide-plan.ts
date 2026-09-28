/**
 * LiTT Verification Foundation — plan verdict aggregation (pure, deterministic).
 *
 * Aggregation: any FAIL => FAIL; else any BLOCKED => BLOCKED; else any
 * INCONCLUSIVE => INCONCLUSIVE; else PASS. Optional checks that were
 * skipped with a valid reason never block the plan (INV-018).
 */
import type { DecidePlanInput, PlanVerdict } from "../types";
import { decideCheck } from "./decide-check";

export function decidePlan(input: DecidePlanInput): PlanVerdict {
  const nowMs = Date.parse(input.nowIso);
  const checkVerdicts = input.checks.map((check) =>
    decideCheck({
      check,
      evidence: input.evidence,
      quarantinedEvidenceIds: input.quarantinedEvidenceIds,
      policy: input.policy,
      hasPreMutationCheckpoint: input.checkpointFacts[check.id] ?? false,
      nowMs,
    }),
  );

  // Deterministic order: sort by check key.
  checkVerdicts.sort((a, b) => a.checkKey.localeCompare(b.checkKey));

  let verdict: PlanVerdict["verdict"] = "pass";
  if (checkVerdicts.some((c) => c.verdict === "fail")) verdict = "fail";
  else if (checkVerdicts.some((c) => c.verdict === "blocked")) verdict = "blocked";
  else if (checkVerdicts.some((c) => c.verdict === "inconclusive")) verdict = "inconclusive";

  const evidenceIds = [
    ...new Set(checkVerdicts.flatMap((c) => c.evidenceIds)),
  ].sort();
  const policyViolations = checkVerdicts
    .filter((c) => c.policyViolation)
    .map((c) => `${c.checkKey}:policy_violation`);

  return {
    verdict,
    checkVerdicts,
    evidenceIds,
    policyViolations,
    decidedAt: input.nowIso,
  };
}
