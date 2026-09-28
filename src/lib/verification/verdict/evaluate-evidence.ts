/**
 * LiTT Verification Foundation — evidence validity evaluation (pure).
 *
 * Only valid, non-stale, non-quarantined evidence may participate in PASS.
 * Invalid evidence is classified here; the store layer quarantines it.
 */
import type { EvidenceRecord } from "../types";
import { evidencePayloadSchema } from "../contracts/evidence";
import { maxEvidenceAgeMs } from "../policy";
import { hashPayload, hashesEqual } from "../hashes";
import type { CheckDefinition, PolicySnapshot } from "../types";

export type EvidenceValidity =
  | { valid: true }
  | { valid: false; reason: "schema_invalid" | "stale" | "hash_mismatch" };

export interface EvidenceClassificationContext {
  check: CheckDefinition;
  policy: PolicySnapshot;
  nowMs: number;
}

/**
 * Classify one evidence record. Pure and deterministic.
 * Note: hash verification against artifact *content* happens where the
 * content is available (store layer); here we validate structural integrity.
 */
export function classifyEvidence(
  evidence: EvidenceRecord,
  ctx: EvidenceClassificationContext,
): EvidenceValidity {
  // 1. Schema validity (Zod mirrors the JSON schema contract).
  const parsed = evidencePayloadSchema.safeParse({
    schema_version: evidence.schemaVersion,
    evidence_type: evidence.evidenceType,
    source: evidence.source,
    collected_at: evidence.collectedAt,
    action_run_id: evidence.actionRunId,
    check_id: evidence.checkId,
    attempt_id: evidence.attemptId,
    claim: evidence.claim,
    assertions: evidence.assertions,
    payload: evidence.payload,
    integrity: evidence.integrity,
    redacted: evidence.redacted,
  });
  if (!parsed.success) return { valid: false, reason: "schema_invalid" };

  // 2. Staleness: evidence older than the check/policy max age is stale.
  const maxAge = maxEvidenceAgeMs(ctx.check, ctx.policy);
  if (maxAge !== null) {
    const collectedMs = Date.parse(evidence.collectedAt);
    if (Number.isNaN(collectedMs)) return { valid: false, reason: "schema_invalid" };
    if (ctx.nowMs - collectedMs > maxAge) return { valid: false, reason: "stale" };
  }

  // 3. Hash integrity: the tamper-evident seal over the canonical evidence
  //    content must recompute exactly. Any post-write mutation of claim,
  //    assertions, or payload invalidates the evidence.
  if (evidence.integrity.sha256) {
    const recomputed = hashPayload({
      claim: evidence.claim,
      assertions: evidence.assertions,
      payload: evidence.payload,
    });
    if (!hashesEqual(recomputed, evidence.integrity.sha256)) {
      return { valid: false, reason: "hash_mismatch" };
    }
  }

  return { valid: true };
}

/**
 * Filter an evidence set down to the valid subset for one check.
 * Quarantined ids are always excluded — quarantined evidence never
 * participates in PASS, even if it later looks structurally fine.
 */
export function selectValidEvidence(
  all: EvidenceRecord[],
  checkId: string,
  quarantinedIds: Set<string> | string[],
  ctx: Omit<EvidenceClassificationContext, "check"> & { check: CheckDefinition },
): { valid: EvidenceRecord[]; invalid: Array<{ evidence: EvidenceRecord; reason: string }> } {
  const quarantined = quarantinedIds instanceof Set ? quarantinedIds : new Set(quarantinedIds);
  const valid: EvidenceRecord[] = [];
  const invalid: Array<{ evidence: EvidenceRecord; reason: string }> = [];
  for (const ev of all) {
    if (ev.checkId !== checkId) continue;
    if (quarantined.has(ev.id)) {
      invalid.push({ evidence: ev, reason: "quarantined" });
      continue;
    }
    const classification = classifyEvidence(ev, ctx);
    if (classification.valid) valid.push(ev);
    else invalid.push({ evidence: ev, reason: classification.reason });
  }
  return { valid, invalid };
}
