/**
 * LiTT Verification Foundation — assertion evaluation (pure).
 *
 * An assertion is a named expected-vs-observed comparison. A check passes
 * only when its required assertions are affirmatively proven by valid,
 * non-stale, non-conflicting evidence.
 */
import type { AssertionResult, EvidenceRecord } from "../types";
import { allAssertionsPass } from "../assertions";

export interface AssertionEvaluation {
  /** assertion name -> every observed result across the evidence set. */
  byName: Map<string, AssertionResult[]>;
  /** Names where every observation passed. */
  proven: string[];
  /** Names with at least one failing observation. */
  failed: string[];
}

/** Evaluate the union of assertions across a valid evidence set. */
export function evaluateAssertions(evidence: EvidenceRecord[]): AssertionEvaluation {
  const byName = new Map<string, AssertionResult[]>();
  for (const ev of evidence) {
    for (const a of ev.assertions) {
      const list = byName.get(a.name) ?? [];
      list.push(a);
      byName.set(a.name, list);
    }
  }
  const proven: string[] = [];
  const failed: string[] = [];
  for (const [name, results] of byName) {
    if (allAssertionsPass(results)) proven.push(name);
    else failed.push(name);
  }
  return { byName, proven, failed };
}

/**
 * Machine-proof check: at least one evidence item in the set comes from a
 * machine/system source. Agent narration alone can never satisfy a machine
 * proof requirement (unless the check explicitly allows narration).
 */
export function hasMachineProof(evidence: EvidenceRecord[]): boolean {
  return evidence.some((ev) => ev.source === "machine" || ev.source === "system");
}
