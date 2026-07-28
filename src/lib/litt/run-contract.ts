/**
 * Canonical LiTT Run Contract — typed event union with runtime validation.
 *
 * This is the single source of truth for the run lifecycle:
 *   run.created → kernel.decision.created → message.user.created →
 *   canvas.block.created → message.assistant.started →
 *   message.assistant.delta → canvas.block.updated →
 *   message.assistant.completed → run.completed | run.failed
 *
 * Rules:
 * - Events are ordered by monotonically increasing sequence.
 * - Every event is persisted before or atomically with publication.
 * - Reconnection can replay events after a supplied sequence number.
 * - Duplicate delivery must not create duplicate messages or Canvas blocks.
 * - Transport status is not conversation content.
 *
 * @see supabase/migrations/20260728100000_litt_run_contract.sql
 */

import { z } from "zod";

// ─── Canonical Message ──────────────────────────────────────────

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageStatusSchema = z.enum([
  "pending",
  "streaming",
  "complete",
  "failed",
  "cancelled",
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const InputModeSchema = z.enum(["text", "voice", "tool"]);
export type InputMode = z.infer<typeof InputModeSchema>;

export const MessageErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type MessageError = z.infer<typeof MessageErrorSchema>;

export const CanonicalMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  runId: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  status: MessageStatusSchema,
  inputMode: InputModeSchema,
  canvasBlockId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  error: MessageErrorSchema.nullable().optional(),
});
export type CanonicalMessage = z.infer<typeof CanonicalMessageSchema>;

// ─── Canvas Transcript Block ─────────────────────────────────────

export const CanvasTranscriptBlockSchema = z.object({
  id: z.string().uuid(),
  canvasId: z.string().uuid(),
  messageId: z.string().uuid().nullable().optional(),
  speaker: z.enum(["user", "litt", "spark"]),
  content: z.string(),
  status: z.enum(["streaming", "complete", "failed"]),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CanvasTranscriptBlock = z.infer<
  typeof CanvasTranscriptBlockSchema
>;

// ─── Run Error ────────────────────────────────────────────────────

export const RunErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type RunError = z.infer<typeof RunErrorSchema>;

// ─── LiTT Run Event Union ────────────────────────────────────────

const baseEventFields = {
  runId: z.string().uuid(),
  sequence: z.number().int().min(1),
  timestamp: z.string(),
};

export const LiTTRunEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseEventFields,
    type: z.literal("run.created"),
    conversationId: z.string().uuid(),
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("kernel.decision.created"),
    decision: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("message.user.created"),
    message: CanonicalMessageSchema,
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("canvas.block.created"),
    block: CanvasTranscriptBlockSchema,
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("message.assistant.started"),
    message: CanonicalMessageSchema,
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("message.assistant.delta"),
    messageId: z.string().uuid(),
    delta: z.string(),
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("canvas.block.updated"),
    blockId: z.string().uuid(),
    content: z.string(),
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("message.assistant.completed"),
    message: CanonicalMessageSchema,
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("run.completed"),
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("run.failed"),
    error: RunErrorSchema,
  }),
  z.object({
    ...baseEventFields,
    type: z.literal("run.cancelled"),
  }),
]);

export type LiTTRunEvent = z.infer<typeof LiTTRunEventSchema>;

// ─── Run Status ──────────────────────────────────────────────────

export const RunStatusSchema = z.enum([
  "pending",
  "running",
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// ─── Kernel Decision Summary (safe for UI display) ───────────────

export const KernelDecisionSummarySchema = z.object({
  mode: z.string(),
  requiresProject: z.boolean(),
  capabilityIds: z.array(z.string()),
  skillIds: z.array(z.string()),
  modelProfileId: z.string(),
  risk: z.string(),
  approvalRequired: z.boolean(),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
});
export type KernelDecisionSummary = z.infer<typeof KernelDecisionSummarySchema>;

// ─── API Request/Response Shapes ────────────────────────────────

export const CreateRunRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  missionId: z.string().uuid().optional(),
  canvasId: z.string().uuid().optional(),
  inputMode: InputModeSchema.default("text"),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const CreateRunResponseSchema = z.object({
  runId: z.string().uuid(),
  conversationId: z.string().uuid(),
  userMessage: CanonicalMessageSchema,
  kernelDecision: z.record(z.string(), z.unknown()),
  // SSE endpoint for streaming events
  eventsUrl: z.string(),
});
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

export const GetEventsRequestSchema = z.object({
  runId: z.string().uuid(),
  afterSequence: z.number().int().min(0).default(0),
});
export type GetEventsRequest = z.infer<typeof GetEventsRequestSchema>;

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Validate and parse a run event from a DB row.
 * Throws ZodError if the payload doesn't match the event schema.
 */
export function parseRunEvent(
  type: string,
  payload: unknown,
  runId: string,
  sequence: number,
  timestamp: string,
): LiTTRunEvent {
  const base = { runId, sequence, timestamp };
  const raw = { ...base, type, ...(payload as Record<string, unknown>) };
  return LiTTRunEventSchema.parse(raw);
}

/**
 * SSE event line formatter.
 */
export function formatSSEEvent(event: LiTTRunEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
