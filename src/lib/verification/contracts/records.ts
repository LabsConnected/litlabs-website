/** Zod contracts: artifact, verdict, failure, quarantine, policy snapshot. */
import { z } from "zod";
import { verdictSchema } from "./evidence";

export const artifactInputSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byte_size: z.number().int().nonnegative(),
  content_type: z.string().nullable().optional(),
  storage_ref: z.string().min(1),
});

export const verdictRecordSchema = z.object({
  action_run_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable().optional(),
  check_id: z.string().uuid().nullable().optional(),
  user_id: z.string().min(1),
  verdict: verdictSchema,
  rationale: z.record(z.string(), z.unknown()).default({}),
  evidence_ids: z.array(z.string().uuid()).default([]),
});

export const failureInputSchema = z.object({
  action_run_id: z.string().uuid(),
  attempt_id: z.string().uuid().nullable().optional(),
  check_id: z.string().uuid().nullable().optional(),
  user_id: z.string().min(1),
  code: z.string().min(1).max(120),
  message: z.string().min(1),
});

export const quarantineReasonSchema = z.enum([
  "schema_invalid",
  "hash_mismatch",
  "corrupt",
  "impossible",
  "untrusted",
  "secret_detected",
]);

export const quarantineInputSchema = z.object({
  action_run_id: z.string().uuid(),
  evidence_id: z.string().uuid().nullable().optional(),
  user_id: z.string().min(1),
  reason: quarantineReasonSchema,
  detail: z.record(z.string(), z.unknown()).default({}),
});

export const policySnapshotInputSchema = z.object({
  plan_id: z.string().uuid(),
  action_run_id: z.string().uuid(),
  user_id: z.string().min(1),
  policy: z.object({
    allowOptionalSkip: z.boolean(),
    defaultMaxEvidenceAgeMs: z.number().int().positive().nullable(),
    validSkipReasons: z.array(z.string().min(1)),
  }),
});

export type ArtifactInput = z.infer<typeof artifactInputSchema>;
export type VerdictRecordInput = z.infer<typeof verdictRecordSchema>;
export type FailureInput = z.infer<typeof failureInputSchema>;
export type QuarantineInput = z.infer<typeof quarantineInputSchema>;
