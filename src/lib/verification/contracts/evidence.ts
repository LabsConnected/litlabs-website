/**
 * LiTT Verification Foundation — Zod contracts (internal TS boundaries).
 * zod v4. These validate inputs at module boundaries; persisted payloads
 * additionally conform to the versioned JSON Schemas in schemas/.
 */
import { z } from "zod";
import { EVIDENCE_SCHEMA_VERSION } from "../types";

export const verdictSchema = z.enum(["pass", "fail", "blocked", "inconclusive"]);
export type VerdictInput = z.infer<typeof verdictSchema>;

export const evidenceSourceSchema = z.enum(["machine", "agent", "human", "system"]);

export const evidenceTypeSchema = z.enum([
  "command_result",
  "http_check",
  "assertion_set",
  "state_reconciliation",
  "provider_verification",
  "checkpoint",
  "narration",
]);

export const assertionResultSchema = z.object({
  name: z.string().min(1),
  expected: z.string(),
  observed: z.string(),
  pass: z.boolean(),
});

export const evidenceIntegritySchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  artifactIds: z.array(z.string().min(1)).optional(),
  staleAfterMs: z.number().int().positive().nullable().optional(),
});

export const evidencePayloadSchema = z.object({
  schema_version: z.literal(EVIDENCE_SCHEMA_VERSION),
  evidence_type: evidenceTypeSchema,
  source: evidenceSourceSchema,
  collected_at: z.string().datetime(),
  action_run_id: z.string().uuid(),
  check_id: z.string().uuid().nullable().optional(),
  attempt_id: z.string().uuid().nullable().optional(),
  claim: z.string().min(1),
  assertions: z.array(assertionResultSchema),
  payload: z.record(z.string(), z.unknown()).default({}),
  integrity: evidenceIntegritySchema.default({}),
  redacted: z.boolean(),
});

export type EvidencePayloadInput = z.infer<typeof evidencePayloadSchema>;
