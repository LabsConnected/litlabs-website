// Canonical metering emitter — the SINGLE writer of usage_events + cost_events.
//
// Every provider-costing path in the app must emit ONE usage_event per
// USER ACTION, plus one cost_events row PER PROVIDER ATTEMPT (success or
// failure). Failed attempts emit cost_events only — they must NOT create
// additional usage_event rows. The credit_ledger remains the system of
// record for *charges*; these tables are the system of record for *costs*.
// The ledger must reconcile against them.
//
// ── Event identity ─────────────────────────────────────────────────────
// idempotencyKey: unique per USER ACTION (not per attempt). Format:
//   `metering:{scope}:{requestId}` where scope is the feature (e.g. "llm",
//   "image", "tts"). Upsert on the unique idempotency_key makes re-emission
//   safe — all provider attempts in a failover chain share the same key
//   and collapse to a single usage_event row.
// retrySequence / originalRequestId: link failover/retry attempts so the
//   reconciliation report can show "3 attempts, 1 success".
//
// ── Charge linkage ─────────────────────────────────────────────────────
// When a ledger debit corresponds to this event, pass ledgerIdempotencyKey
// (the debit_credits idempotency key). The emitter stamps
// credit_ledger.usage_event_id so charges join to their cost events.
// Alternatively, emit the charge event with the SAME idempotency key as the
// ledger debit (the pattern recordChargeEvidence uses).
//
// ── Money ────────────────────────────────────────────────────────────
// providerCostMicros: what LiTT paid the provider (USD micros). ALWAYS
//   recorded, even for failed attempts and free models ($0 — metered, not
//   invisible).
// retailBits / chargedBits: rated via the cost engines. The $1/1K-bit
//   conversion is a PRICING MODEL, not validated fact — it is labeled
//   `modeled` everywhere and must not be presented as measured.
//
// ── Reliability ──────────────────────────────────────────────────────
// Best-effort by design: metering must NEVER break the product path.
// emitUsageEvent catches everything and returns { usageEventId: null,
// skipped } on failure. Tests assert emission via the returned id.

import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Canonical metering event status. */
export type MeteringStatus = "success" | "failed";

/** Billable capability — maps to usage_events.capability. */
export type MeteringCapability =
  | "llm"
  | "image"
  | "video"
  | "music"
  | "speech"
  | "agent_run"
  | "browser"
  | "transcription";

/** Feature labels for usage_events.billability_cause context / reporting. */
export const METERING_FEATURES = [
  "studio-chat",
  "chat-unified",
  "agent-chat",
  "agents-chat",
  "ai-chat",
  "conversations",
  "gemini",
  "gemini-chat",
  "gemini-build",
  "litt-think",
  "canvas-ai",
  "demo-chat",
  "browser-agent",
  "image-gen",
  "image-edit",
  "video-gen",
  "audio-gen",
  "music-gen",
  "music-enhance",
  "music-producer",
  "tts",
  "voice-realtime",
  "vapi",
  "transcription",
  "media-analyze",
  "studio-generate",
  "studio-video",
  "cli",
  "unknown",
] as const;
export type MeteringFeature = (typeof METERING_FEATURES)[number];

/**
 * Ambient metering context, threaded via AsyncLocalStorage so deep provider
 * layers (dispatchProvider in llm.ts) can emit without signature changes.
 * Routes set this at the request boundary via runWithMeteringContext().
 */
export interface MeteringContext {
  /** Internal users.id (uuid). Preferred — usage_events.user_id is uuid. */
  userId?: string;
  /** Clerk id — resolved to uuid via cached lookup when userId is absent. */
  clerkId?: string;
  /** Project uuid, when the call belongs to a project. */
  projectId?: string;
  /** Run uuid, when the call belongs to a run. */
  runId?: string;
  /** Feature label for reporting. */
  feature: MeteringFeature | string;
}

const meteringAls = new AsyncLocalStorage<MeteringContext>();

/** Run fn with ambient metering context (routes call this at the boundary). */
export function runWithMeteringContext<T>(ctx: MeteringContext, fn: () => T): T {
  return meteringAls.run(ctx, fn);
}

/** Read the ambient metering context, if any. */
export function getMeteringContext(): MeteringContext | undefined {
  return meteringAls.getStore();
}

// ── User resolution ──────────────────────────────────────────────────

const userUuidCache = new Map<string, string | null>();

/** Resolve a Clerk id to the internal users.id uuid (cached). */
export async function resolveMeteringUserUuid(
  clerkId: string,
): Promise<string | null> {
  const cached = userUuidCache.get(clerkId);
  if (cached !== undefined) return cached;
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return null;
    const { data } = await admin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .maybeSingle();
    const uuid = (data?.id as string | undefined) ?? null;
    userUuidCache.set(clerkId, uuid);
    return uuid;
  } catch {
    return null;
  }
}

/** Clear the user-uuid cache (tests). */
export function _clearMeteringUserCache(): void {
  userUuidCache.clear();
}

// ── Emission ─────────────────────────────────────────────────────────

export interface EmitUsageEventInput {
  // Identity — explicit values win; otherwise the ALS context is used.
  userId?: string;
  clerkId?: string;
  projectId?: string;
  runId?: string;
  feature?: MeteringFeature | string;

  // What happened
  capability: MeteringCapability;
  provider: string;
  model: string;

  // Units
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  videoSeconds?: number;
  audioSeconds?: number;
  computeMs?: number;
  toolCalls?: number;

  // Money — providerCostMicros is REQUIRED (0 for free models).
  // retailBits/chargedBits are rated via the cost engines; the $1/1K-bit
  // conversion behind them is a PRICING MODEL (labeled `modeled`), not fact.
  providerCostMicros: number;
  retailBits?: number;
  chargedBits?: number;

  // Status
  status: MeteringStatus;
  /** Defaults to status === "success". Failed attempts that cost money
   *  are recorded with billable=false and the cost captured. */
  billable?: boolean;
  error?: string;
  isByok?: boolean;

  // Idempotency — one event per provider ATTEMPT.
  idempotencyKey: string;
  retrySequence?: number;
  originalRequestId?: string;

  // Timing
  startedAt?: Date;
  finishedAt?: Date;

  /**
   * When this event corresponds to a ledger debit, pass the debit's
   * idempotency key so credit_ledger.usage_event_id gets stamped.
   */
  ledgerIdempotencyKey?: string;
}

export interface EmitUsageEventResult {
  usageEventId: string | null;
  /** Set when the event was not written (e.g. no resolvable user). */
  skipped?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | undefined): string | null =>
  v && UUID_RE.test(v) ? v : null;

/**
 * Emit one canonical metering event (usage_events + cost_events).
 * Best-effort: never throws; failures are logged and reported via `skipped`.
 */
export async function emitUsageEvent(
  input: EmitUsageEventInput,
): Promise<EmitUsageEventResult> {
  const ctx = getMeteringContext();

  // Resolve identity: explicit > ALS context.
  const userId =
    input.userId ?? ctx?.userId ?? null;
  const clerkId = input.clerkId ?? ctx?.clerkId ?? null;
  const resolvedUserId =
    userId ?? (clerkId ? await resolveMeteringUserUuid(clerkId) : null);

  if (!resolvedUserId) {
    return { usageEventId: null, skipped: "no-resolvable-user" };
  }

  const projectId = asUuid(input.projectId ?? ctx?.projectId);
  const runId = asUuid(input.runId ?? ctx?.runId);
  const feature = input.feature ?? ctx?.feature ?? "unknown";

  const billable = input.billable ?? input.status === "success";
  const chargedBits = input.chargedBits ?? 0;
  const now = new Date();
  const startedAt = input.startedAt ?? now;
  const finishedAt = input.finishedAt ?? now;

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.error("[metering] getSupabaseAdmin threw:", err instanceof Error ? err.message : err);
    return { usageEventId: null, skipped: "no-admin-client" };
  }
  if (!admin) {
    return { usageEventId: null, skipped: "no-admin-client" };
  }

  try {
    // 1. usage_events — upsert on the unique idempotency_key (replay-safe).
    const { data: usageRow, error: usageErr } = await admin
      .from("usage_events")
      .upsert(
        {
          user_id: resolvedUserId,
          project_id: projectId,
          run_id: runId,
          provider: input.provider,
          model: input.model,
          capability: input.capability,
          input_tokens: input.inputTokens ?? 0,
          output_tokens: input.outputTokens ?? 0,
          compute_ms: input.computeMs ?? 0,
          image_count: input.imageCount ?? 0,
          video_seconds: input.videoSeconds ?? 0,
          audio_seconds: input.audioSeconds ?? 0,
          tool_calls: input.toolCalls ?? 0,
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          idempotency_key: input.idempotencyKey,
          billability_cause: `feature:${feature}`,
          billable,
          // LiTT absorbed the cost when the provider charged us but the
          // user wasn't (owner exemption, free tier, uncharged voice, …).
          liitt_absorbed:
            input.providerCostMicros > 0 && chargedBits === 0 && !input.isByok,
          meter_provider_cost: true,
          retry_sequence: input.retrySequence ?? 0,
          original_request_id: input.originalRequestId ?? null,
          is_byok: input.isByok ?? false,
        },
        { onConflict: "idempotency_key" },
      )
      .select("usage_event_id")
      .single();

    if (usageErr || !usageRow) {
      console.error(
        `[metering] usage_events upsert failed for ${input.idempotencyKey}:`,
        usageErr?.message ?? "no row returned",
      );
      return { usageEventId: null, skipped: "usage-event-write-failed" };
    }

    const usageEventId = usageRow.usage_event_id as string;

    // 2. cost_events — one row per provider attempt. Multiple cost_events
    //    link to the same usage_event_id (1 user action = 1 usage_event,
    //    N attempts = N cost_events). Always insert; replay safety is
    //    handled at the usage_event level via idempotency_key. A replayed
    //    emitUsageEvent call will upsert the same usage_event (no duplicate)
    //    but may insert a duplicate cost_event — acceptable tradeoff for
    //    correct per-attempt cost accounting, and replays are rare.
    const { error: costErr } = await admin.from("cost_events").insert({
      usage_event_id: usageEventId,
      provider_cost_micros: input.providerCostMicros,
      total_cost_micros: input.providerCostMicros,
      rate_card_version: "littbits-pricing-v1",
    });
    if (costErr) {
      console.error(
        `[metering] cost_events insert failed for ${usageEventId}:`,
        costErr.message,
      );
    }

    // 3. Link the ledger debit, when this event backs a charge.
    if (input.ledgerIdempotencyKey) {
      const { error: stampErr } = await admin
        .from("credit_ledger")
        .update({ usage_event_id: usageEventId })
        .eq("idempotency_key", input.ledgerIdempotencyKey);
      if (stampErr) {
        console.error(
          `[metering] ledger stamp failed for ${input.ledgerIdempotencyKey}:`,
          stampErr.message,
        );
      }
    }

    return { usageEventId };
  } catch (err) {
    console.error(
      "[metering] emitUsageEvent threw:",
      err instanceof Error ? err.message : err,
    );
    return { usageEventId: null, skipped: "exception" };
  }
}

/**
 * Convenience: rate + emit an LLM attempt in one call. Provider cost and
 * retail bits come from the canonical cost engine. The $1/1K-bit conversion
 * inside the engine is a PRICING MODEL (`modeled`), not validated fact.
 */
export async function emitLlmMetering(
  input: Omit<EmitUsageEventInput, "capability" | "providerCostMicros" | "retailBits"> & {
    providerCostMicros?: number;
    retailBits?: number;
  },
): Promise<EmitUsageEventResult> {
  const { calculateLlmCost } = await import("@/lib/llm-cost-engine");
  const cost = calculateLlmCost({
    provider: input.provider,
    model: input.model,
    promptTokens: input.inputTokens ?? 0,
    completionTokens: input.outputTokens ?? 0,
    isByok: input.isByok ?? false,
  });
  return emitUsageEvent({
    ...input,
    capability: "llm",
    providerCostMicros: input.providerCostMicros ?? cost.providerCostMicros,
    retailBits: input.retailBits ?? cost.retailLiTTBits,
  });
}
