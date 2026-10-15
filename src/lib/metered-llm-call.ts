// Metered LLM call gateway — canonical billing path for simple LLM routes.
//
// Problem this solves: several API routes called `generateText()` with no
// metering context and no charging logic, letting authenticated users consume
// provider-paid LLM calls for free (no usage_events, no cost_events, no
// wallet debit). LiTT paid the provider; the user paid nothing.
//
// This module composes the canonical billing pieces (it duplicates none of
// them):
//   1. `preflightBillingAuth`  — owner exemption / spend ceiling, BEFORE spend
//   2. `getCreditBalances`     — balance gate BEFORE provider execution
//   3. `generateText` + metering context — one usage_event + cost_event per
//      provider attempt (canonical metering in llm.ts)
//   4. `chargeLlmUsage` with `meteringBillableKey` — exactly ONE wallet debit
//      per logical action; retries/failovers reuse the billable usage_event
//      instead of creating a second one (P0 no-double-billing invariant).
//
// Routes call `meteredLlmCall()` instead of calling `generateText()` directly.

import "server-only";
import {
  generateText,
  type LLMOptions,
  type LLMResult,
} from "@/lib/llm";
import {
  preflightBillingAuth,
  chargeLlmUsage,
  type LlmBillingResult,
} from "@/lib/llm-billing";
import { getCreditBalances } from "@/lib/wallet-ledger";
import { calculateLlmCost } from "@/lib/llm-cost-engine";
import type { SimulatedPlan } from "@/lib/owner";

export interface MeteredLlmCallInput {
  /** Clerk user ID (already authenticated by the route). */
  clerkId: string;
  /** The prompt to send. */
  prompt: string;
  /** Optional system prompt. */
  systemPrompt?: string;
  /** LLM options (task, maxTokens, provider, …). `metering` is injected. */
  llmOptions?: Omit<LLMOptions, "metering">;
  /** Feature label for metering/reporting, e.g. "gemini-api". */
  feature: string;
  /** Unique call ID for charge idempotency (caller generates, e.g. randomUUID()). */
  callId: string;
  /** Optional owner simulation override (exercises real billing for owners). */
  simulation?: SimulatedPlan | null;
}

export type MeteredLlmCallResult =
  | {
      ok: true;
      result: LLMResult;
      billing: LlmBillingResult;
    }
  | {
      ok: false;
      /** HTTP status the route should return. */
      status: 402 | 403;
      error: string;
      code: "spend_ceiling_exceeded" | "insufficient_credits";
    };

export type SpendAuthorization =
  | { ok: true; billingExempt: boolean }
  | { ok: false; status: 402 | 403; error: string; code: "spend_ceiling_exceeded" | "insufficient_credits" };

/**
 * Conservative credit estimate for a call that has not run yet.
 * Uses the generic catalog fallback (unknown provider/model: $0.50 / $1.50
 * per 1M tokens, 50% markup, 1000 credits per $1) so the gate never
 * underprices whichever model the router later picks.
 * Prompt tokens are ceil(chars/4); completion tokens are the requested max.
 */
export function estimateLlmCallCredits(input: {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
}): number {
  const text = `${input.systemPrompt ?? ""}${input.prompt}`;
  const promptTokens = Math.max(1, Math.ceil(text.length / 4));
  const completionTokens = Math.max(1, input.maxTokens ?? 1024);
  const cost = calculateLlmCost({
    provider: "estimate",
    model: "preflight",
    promptTokens,
    completionTokens,
    isByok: false,
  });
  return Math.max(1, cost.retailLiTTBits);
}

/**
 * Pre-flight spend authorization: owner exemption / spend ceiling + balance
 * gate, run BEFORE any provider execution. Exported so routes that build
 * their own provider calls (via shared wrappers) can enforce the same gate
 * without duplicating the logic.
 *
 * Non-exempt callers must hold at least `estimatedCost` credits (default 1,
 * which preserves the historical "balance must be positive" check).
 */
export async function assertSpendAuthorized(
  clerkId: string,
  simulation?: SimulatedPlan | null,
  estimatedCost: number = 1,
): Promise<SpendAuthorization> {
  const preflight = await preflightBillingAuth(clerkId, simulation);
  if (!preflight.allowed) {
    return {
      ok: false,
      status: 403,
      error: "Spend ceiling exceeded",
      code: "spend_ceiling_exceeded",
    };
  }
  if (!preflight.billingExempt) {
    let total = 0;
    try {
      const balances = await getCreditBalances(clerkId);
      total = balances.total;
    } catch {
      // Wallet lookup failure: fail closed for non-exempt users rather
      // than allowing unbounded free provider spend.
      return {
        ok: false,
        status: 402,
        error: "Billing service unavailable",
        code: "insufficient_credits",
      };
    }
    const required = Math.max(1, Math.ceil(estimatedCost));
    if (total < required) {
      return {
        ok: false,
        status: 402,
        error: "Insufficient LiTTBits",
        code: "insufficient_credits",
      };
    }
  }
  return { ok: true, billingExempt: preflight.billingExempt };
}

/**
 * Execute one provider-paid LLM call with full metering + billing.
 *
 * Guarantees:
 * - No provider call happens unless the caller is authorized to spend
 *   (pre-flight auth) AND holds at least the estimated credit cost
 *   (non-exempt users).
 * - Every provider attempt is metered (usage_events + cost_events).
 * - Exactly one wallet debit per logical action (idempotent; retries reuse
 *   the billable usage_event via meteringBillableKey).
 */
export async function meteredLlmCall(
  input: MeteredLlmCallInput,
): Promise<MeteredLlmCallResult> {
  // 1+2. Pre-flight billing authorization + estimated-cost gate, BEFORE provider spend.
  const estimatedCost = estimateLlmCallCredits({
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    maxTokens: input.llmOptions?.maxTokens,
  });
  const authz = await assertSpendAuthorized(
    input.clerkId,
    input.simulation,
    estimatedCost,
  );
  if (!authz.ok) {
    return authz;
  }

  // 3. Provider call WITH canonical metering context. llm.ts emits one
  //    usage_event + cost_event per attempt; the successful attempt's key
  //    becomes the single billable event for this logical action.
  const result = await generateText(
    input.prompt,
    {
      ...input.llmOptions,
      metering: { clerkId: input.clerkId, feature: input.feature },
    },
    input.systemPrompt,
  );

  // 4. Charge exactly once. Idempotent via `llm:{callId}`; reuses the
  //    billable usage_event so retries/failovers never double-charge.
  const billing = await chargeLlmUsage({
    clerkId: input.clerkId,
    provider: result.provider,
    model: result.model,
    promptTokens: result.usage?.prompt ?? 0,
    completionTokens: result.usage?.completion ?? 0,
    isByok: false,
    callId: input.callId,
    simulation: input.simulation,
    meteringBillableKey: result.metering.billableIdempotencyKey,
  });

  // If the debit failed for insufficient funds (balance dropped to zero
  // between the pre-flight gate and the charge — concurrent spend race),
  // do not hand the user free value: report 402 instead of the text.
  // Transient billing errors are best-effort (logged by chargeLlmUsage).
  if (billing.error === "Insufficient LiTTBits") {
    return {
      ok: false,
      status: 402,
      error: "Insufficient LiTTBits",
      code: "insufficient_credits",
    };
  }

  return { ok: true, result, billing };
}
