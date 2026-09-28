/**
 * LiTT Verification Foundation (PASS 2) — domain types.
 *
 * Doctrine: verdicts are DERIVED from persisted evidence. "Unknown" is never
 * success. No valid persisted evidence = no PASS.
 *
 * This module is pure: no I/O, no Supabase, no DOM. Everything here is
 * unit-testable without infrastructure.
 */

/** Verdicts are derived truth — never persisted as the authoritative source. */
export type Verdict = "pass" | "fail" | "blocked" | "inconclusive";

/** Where evidence came from. Only machine/system evidence can satisfy
 *  machine proof requirements; agent narration is provenance only. */
export type EvidenceSource = "machine" | "agent" | "human" | "system";

export type EvidenceType =
  | "command_result"
  | "http_check"
  | "assertion_set"
  | "state_reconciliation"
  | "provider_verification"
  | "checkpoint"
  | "narration";

export interface AssertionResult {
  name: string;
  expected: string;
  observed: string;
  pass: boolean;
}

export interface EvidenceIntegrity {
  /** sha256 of the canonical evidence payload (hex). */
  sha256?: string;
  /** Artifact ids referenced by this evidence. */
  artifactIds?: string[];
  /** Evidence older than this (ms) relative to collectedAt is stale. Null = no expiry. */
  staleAfterMs?: number | null;
}

export interface EvidenceRecord {
  id: string;
  actionRunId: string;
  checkId: string | null;
  attemptId: string | null;
  schemaVersion: string;
  evidenceType: EvidenceType;
  source: EvidenceSource;
  collectedAt: string; // ISO
  claim: string;
  assertions: AssertionResult[];
  payload: Record<string, unknown>;
  integrity: EvidenceIntegrity;
  /** True when secret redaction ran before persistence. */
  redacted: boolean;
}

export interface ArtifactRecord {
  id: string;
  sha256: string;
  byteSize: number;
  contentType: string | null;
  storageRef: string;
  createdAt: string; // ISO
}

export interface CheckDefinition {
  id: string;
  key: string;
  /** Required checks gate the plan verdict; optional checks never block. */
  required: boolean;
  skipped: boolean;
  /** Explicit reason when skipped. Required for optional skips to be non-blocking. */
  skipReason: string | null;
  /** Explicit dependency/policy/precondition blocker (check key or reason). */
  blockedBy: string | null;
  /** Mutation-capable checks require a pre-mutation checkpoint (INV-011/INV-017). */
  requiresMutation: boolean;
  /** Max evidence age in ms; null falls back to policy default. */
  maxEvidenceAgeMs: number | null;
  /** When true, agent/human narration may satisfy this check's assertions. */
  narrationSatisfies: boolean;
}

export interface QuarantineRecord {
  id: string;
  evidenceId: string | null;
  reason:
    | "schema_invalid"
    | "hash_mismatch"
    | "corrupt"
    | "impossible"
    | "untrusted"
    | "secret_detected";
  detail: Record<string, unknown>;
}

export interface PolicySnapshot {
  /** Optional checks may be skipped only with an explicit valid reason. */
  allowOptionalSkip: boolean;
  /** Default max evidence age in ms when a check does not set its own. */
  defaultMaxEvidenceAgeMs: number | null;
  /** Reasons that count as valid for skipping an optional check. */
  validSkipReasons: string[];
}

export interface FailureRecord {
  id: string;
  checkId: string | null;
  attemptId: string | null;
  code: string;
  message: string;
}

export interface CheckVerdict {
  checkId: string;
  checkKey: string;
  verdict: Verdict;
  /** Human/machine-readable reasons, e.g. "missing_evidence", "assertion_failed:exit_code". */
  reasons: string[];
  /** Evidence ids this verdict was derived from. */
  evidenceIds: string[];
  /** True when a required check was skipped without a valid policy reason. */
  policyViolation: boolean;
}

export interface PlanVerdict {
  verdict: Verdict;
  checkVerdicts: CheckVerdict[];
  evidenceIds: string[];
  policyViolations: string[];
  decidedAt: string; // ISO
}

export interface DecidePlanInput {
  checks: CheckDefinition[];
  /** Only valid, non-quarantined evidence reaches the engine. */
  evidence: EvidenceRecord[];
  /** Ids of quarantined evidence (excluded from PASS consideration). */
  quarantinedEvidenceIds: string[];
  failures: FailureRecord[];
  policy: PolicySnapshot;
  /** checkId -> whether a valid pre-mutation checkpoint exists. */
  checkpointFacts: Record<string, boolean>;
  /** Evaluation time (ISO). Evidence staleness is measured against this. */
  nowIso: string;
}

export const VERDICTS: Verdict[] = ["pass", "fail", "blocked", "inconclusive"];

export const EVIDENCE_SCHEMA_VERSION = "1.0.0";
