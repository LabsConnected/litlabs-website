/**
 * LiTT Verification Foundation — policy evaluation.
 *
 * Skip policy: required checks may never be skipped. Optional checks may be
 * skipped only with an explicit reason that the policy snapshot deems valid.
 * Pure: no I/O.
 */
import type { CheckDefinition, PolicySnapshot } from "./types";

export type SkipEvaluation =
  | { kind: "not_skipped" }
  | { kind: "optional_skip_ok"; reason: string }
  | { kind: "required_skip_violation"; reason: string | null }
  | { kind: "optional_skip_invalid_reason"; reason: string };

/** Default policy used when no snapshot was frozen for a plan. */
export function defaultPolicy(): PolicySnapshot {
  return {
    allowOptionalSkip: true,
    defaultMaxEvidenceAgeMs: 5 * 60 * 1000, // 5 minutes
    validSkipReasons: [
      "not_applicable",
      "environment_unavailable",
      "superseded_by_newer_check",
      "manual_owner_waiver",
    ],
  };
}

function isValidReason(reason: string | null, policy: PolicySnapshot): boolean {
  if (!reason) return false;
  const normalized = reason.trim().toLowerCase();
  return policy.validSkipReasons.some((r) => r.toLowerCase() === normalized);
}

/**
 * Evaluate a check's skip state against policy.
 * INV-009: a required stage without evidence cannot complete; every skipped
 * stage records a reason.
 */
export function evaluateSkip(
  check: CheckDefinition,
  policy: PolicySnapshot,
): SkipEvaluation {
  if (!check.skipped) return { kind: "not_skipped" };
  if (check.required) {
    return { kind: "required_skip_violation", reason: check.skipReason };
  }
  if (!policy.allowOptionalSkip) {
    return { kind: "optional_skip_invalid_reason", reason: check.skipReason ?? "" };
  }
  if (isValidReason(check.skipReason, policy)) {
    return { kind: "optional_skip_ok", reason: check.skipReason as string };
  }
  return { kind: "optional_skip_invalid_reason", reason: check.skipReason ?? "" };
}

/**
 * Maximum evidence age (ms) for a check: check-level override wins, then the
 * policy default. Null means evidence never expires by age.
 */
export function maxEvidenceAgeMs(
  check: CheckDefinition,
  policy: PolicySnapshot,
): number | null {
  if (check.maxEvidenceAgeMs !== null && check.maxEvidenceAgeMs !== undefined) {
    return check.maxEvidenceAgeMs;
  }
  return policy.defaultMaxEvidenceAgeMs;
}
