/** Zod contracts: plan, check, attempt. */
import { z } from "zod";

export const planInputSchema = z.object({
  action_run_id: z.string().uuid(),
  mission_run_id: z.string().uuid().nullable().optional(),
  user_id: z.string().min(1),
  name: z.string().min(1),
});

export const checkInputSchema = z.object({
  plan_id: z.string().uuid(),
  action_run_id: z.string().uuid(),
  user_id: z.string().min(1),
  key: z.string().min(1).max(120),
  required: z.boolean().default(true),
  blocked_by: z.string().nullable().optional(),
  requires_mutation: z.boolean().default(false),
  max_evidence_age_ms: z.number().int().positive().nullable().optional(),
  narration_satisfies: z.boolean().default(false),
});

export const checkSkipSchema = z.object({
  skipped: z.boolean(),
  skip_reason: z.string().min(1).nullable().optional(),
});

export const attemptInputSchema = z.object({
  check_id: z.string().uuid(),
  action_run_id: z.string().uuid(),
  user_id: z.string().min(1),
  executor: z.string().min(1),
  command_identity: z.string().min(1),
});

export const attemptFinishSchema = z.object({
  exit_code: z.number().int().nullable(),
  finished_at: z.string().datetime(),
});

export type PlanInput = z.infer<typeof planInputSchema>;
export type CheckInput = z.infer<typeof checkInputSchema>;
export type AttemptInput = z.infer<typeof attemptInputSchema>;
