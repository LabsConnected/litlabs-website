/**
 * LiTT Verification Foundation — per-check verdict (pure, deterministic).
 *
 * Decision order for a check:
 *   1. skipped            -> policy evaluation (violation => cannot PASS)
 *   2. explicit blocker   -> BLOCKED
 *   3. mutation w/o checkpoint -> BLOCKED (INV-011/INV-017; never PASS)
 *   4. no valid evidence  -> INCONCLUSIVE
 *   5. conflicting authoritative proof -> INCONCLUSIVE
 *   6. authoritative assertion failure -> FAIL
 *   7. narration only, machine proof required -> INCONCLUSIVE
 *   8. otherwise          -> PASS
 */
import type {
  CheckDefinition,
  CheckVerdict,
  EvidenceRecord,
  PolicySnapshot,
} from "../types";
import { evaluateSkip } from "../policy";
import { selectValidEvidence } from "./evaluate-evidence";
import { evaluateAssertions, hasMachineProof } from "./evaluate-assertion";
import { detectConflicts } from "./detect-conflicts";

export interface DecideCheckContext {
  check: CheckDefinition;
  evidence: EvidenceRecord[];
  quarantinedEvidenceIds: string[];
  policy: PolicySnapshot;
  /** Whether a valid pre-mutation checkpoint exists for this check. */
  hasPreMutationCheckpoint: boolean;
  nowMs: number;
}

export function decideCheck(ctx: DecideCheckContext): CheckVerdict {
  const { check } = ctx;
  const base: CheckVerdict = {
    checkId: check.id,
    checkKey: check.key,
    verdict: "inconclusive",
    reasons: [],
    evidenceIds: [],
    policyViolation: false,
  };

  // 1. Skip policy.
  const skip = evaluateSkip(check, ctx.policy);
  if (skip.kind === "required_skip_violation") {
    return {
      ...base,
      reasons: ["required_check_skipped_without_valid_reason"],
      policyViolation: true,
    };
  }
  if (skip.kind === "optional_skip_invalid_reason") {
    return {
      ...base,
      reasons: ["optional_check_skipped_without_valid_reason"],
      policyViolation: true,
    };
  }
  if (skip.kind === "optional_skip_ok") {
    return { ...base, verdict: "pass", reasons: [`skipped:${skip.reason}`] };
  }

  // 2. Explicit blocker (dependency/policy/precondition).
  if (check.blockedBy) {
    return { ...base, verdict: "blocked", reasons: [`blocked_by:${check.blockedBy}`] };
  }

  // 3. Checkpoint invariant: mutation without a pre-mutation checkpoint
  //    can never PASS (INV-011, INV-017).
  if (check.requiresMutation && !ctx.hasPreMutationCheckpoint) {
    return {
      ...base,
      verdict: "blocked",
      reasons: ["missing_pre_mutation_checkpoint"],
    };
  }

  // 4. Select valid evidence (schema-valid, non-stale, non-quarantined).
  const { valid } = selectValidEvidence(ctx.evidence, check.id, ctx.quarantinedEvidenceIds, {
    check,
    policy: ctx.policy,
    nowMs: ctx.nowMs,
  });
  if (valid.length === 0) {
    return { ...base, reasons: ["missing_evidence"] };
  }
  base.evidenceIds = valid.map((ev) => ev.id).sort();

  // 5. Conflicting authoritative proof => INCONCLUSIVE.
  const conflicts = detectConflicts(valid);
  if (conflicts.length > 0) {
    return {
      ...base,
      reasons: conflicts.map((c) => `conflicting_proof:${c.assertionName}`),
    };
  }

  // 6. Authoritative assertion failure => FAIL.
  const evaluation = evaluateAssertions(valid);
  if (evaluation.failed.length > 0) {
    return {
      ...base,
      verdict: "fail",
      reasons: evaluation.failed.map((n) => `assertion_failed:${n}`),
    };
  }

  // 7. Machine proof required but only narration present => INCONCLUSIVE.
  //    LLM/assistant narration alone can never produce machine PASS.
  if (!check.narrationSatisfies && !hasMachineProof(valid)) {
    return { ...base, reasons: ["narration_only_insufficient_for_machine_proof"] };
  }

  // 8. Every required assertion affirmatively proven.
  return {
    ...base,
    verdict: "pass",
    reasons: evaluation.proven.map((n) => `assertion_proven:${n}`),
  };
}
