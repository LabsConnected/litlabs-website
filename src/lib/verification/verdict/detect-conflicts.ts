/**
 * LiTT Verification Foundation — conflict detection (pure).
 *
 * Conflicting authoritative proof => INCONCLUSIVE. Two valid evidence items
 * for the same assertion with opposite outcomes, both from authoritative
 * (machine/system) sources, mean the truth cannot be established.
 */
import type { EvidenceRecord } from "../types";

export interface EvidenceConflict {
  assertionName: string;
  passing: EvidenceRecord[];
  failing: EvidenceRecord[];
}

const AUTHORITATIVE_SOURCES = new Set(["machine", "system"]);

/**
 * Detect conflicts across a valid evidence set. Deterministic: conflicts
 * are sorted by assertion name; evidence within a conflict sorted by id.
 */
export function detectConflicts(evidence: EvidenceRecord[]): EvidenceConflict[] {
  const byAssertion = new Map<string, { pass: EvidenceRecord[]; fail: EvidenceRecord[] }>();
  for (const ev of evidence) {
    for (const a of ev.assertions) {
      let bucket = byAssertion.get(a.name);
      if (!bucket) {
        bucket = { pass: [], fail: [] };
        byAssertion.set(a.name, bucket);
      }
      (a.pass ? bucket.pass : bucket.fail).push(ev);
    }
  }
  const conflicts: EvidenceConflict[] = [];
  for (const [assertionName, bucket] of byAssertion) {
    const authoritativePass = bucket.pass.filter((ev) =>
      AUTHORITATIVE_SOURCES.has(ev.source),
    );
    const authoritativeFail = bucket.fail.filter((ev) =>
      AUTHORITATIVE_SOURCES.has(ev.source),
    );
    if (authoritativePass.length > 0 && authoritativeFail.length > 0) {
      conflicts.push({
        assertionName,
        passing: [...authoritativePass].sort((x, y) => x.id.localeCompare(y.id)),
        failing: [...authoritativeFail].sort((x, y) => x.id.localeCompare(y.id)),
      });
    }
  }
  conflicts.sort((a, b) => a.assertionName.localeCompare(b.assertionName));
  return conflicts;
}

/** True when the evidence set contains conflicting authoritative proof. */
export function hasConflictingProof(evidence: EvidenceRecord[]): boolean {
  return detectConflicts(evidence).length > 0;
}
