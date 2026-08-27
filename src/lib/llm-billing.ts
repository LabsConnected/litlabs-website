// LLM Billing — charges LiTTBits for LLM usage after a successful call.
//
// This module bridges the cost engine and the wallet ledger. It is called
// AFTER a successful LLM call completes, using the actual returned token
// usage. It never charges for:
//   - BYOK calls (user's own API key)
//   - Failed provider attempts (only successful calls are charged)
//   - Shadow mode (calculate + record, no debit)
//
// Idempotency: each charge uses a unique key tied to the execution/call ID,
// so retries never double-debit. The debit_credits RPC is itself idempotent.
//
// Usage records are persisted for platform cost analysis and margin verification.

import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { calculateLlmCost, isShadowMode, type CostCalculation } from "@/lib/llm-cost-engine";
import { isOwnerClerkId, isBillingExempt, isOwnerWithinSpendCeiling, OWNER_SPEND_CEILING_USD, type SimulatedPlan } from "@/lib/owner";

export interface LlmBillingInput {
  /** Clerk user ID */
  clerkId: string;
  /** The LLM provider that successfully handled the call */
  provider: string;
  /** The model name returned by the provider */
  model: string;
  /** Actual prompt tokens from the provider response */
  promptTokens: number;
  /** Actual completion tokens from the provider response */
  completionTokens: number;
  /** True if the user supplied their own API key (BYOK) */
  isByok: boolean;
  /** LiTT alias ID if the call was routed through a branded alias */
  littAliasId?: string;
  /** Unique call/execution ID for idempotency */
  callId: string;
  /**
   * Optional owner simulation override. When omitted, billing exemption
   * is determined by isOwnerClerkId(clerkId) only (no cookie read —
   * safe for background jobs). Pass the resolved simulation when
   * available so simulating a customer tier exercises real billing.
   */
  simulation?: SimulatedPlan | null;
}

export interface LlmBillingResult {
  /** Whether the charge was calculated */
  calculated: boolean;
  /** The cost calculation details */
  cost: CostCalculation;
  /** Whether the wallet was actually debited */
  debited: boolean;
  /** Remaining balance after debit (if debited) */
  balance: number | null;
  /** True if this idempotency key was already used */
  replayed: boolean;
  /** Error message if the debit failed */
  error?: string;
}

/**
 * Pre-flight billing authorization check.
 *
 * Call this BEFORE executing a provider request to determine whether
 * the request should be allowed. This checks:
 *   - Owner spend ceiling (if billing-exempt owner)
 *   - Returns the exemption status so callers can skip balance checks
 *
 * Returns:
 *   - { allowed: true, billingExempt: true }  → owner, skip balance check
 *   - { allowed: true, billingExempt: false } → normal user, check balance
 *   - { allowed: false, reason: "spend_ceiling_exceeded" } → owner over ceiling
 */
export async function preflightBillingAuth(
  clerkId: string,
  simulation?: SimulatedPlan | null,
): Promise<
  | { allowed: true; billingExempt: boolean }
  | { allowed: false; reason: string; spendMicros?: number }
> {
  const exempt = isBillingExempt(clerkId, simulation);

  if (exempt) {
    // Check the monthly spend ceiling for the owner
    const { withinCeiling, spendMicros } = await isOwnerWithinSpendCeiling(clerkId);
    if (!withinCeiling) {
      return {
        allowed: false,
        reason: "spend_ceiling_exceeded",
        spendMicros: spendMicros ?? undefined,
      };
    }
    return { allowed: true, billingExempt: true };
  }

  return { allowed: true, billingExempt: false };
}

/**
 * Charge LiTTBits for an LLM call after successful completion.
 *
 * In shadow mode: calculates and records the expected charge but does NOT
 * debit the wallet. This allows verifying margin calculations against real
 * provider invoices before enabling enforcement.
 *
 * For BYOK: no charge is calculated or debited. The provider bills the user
 * directly. Returns a zero-charge result for audit purposes.
 *
 * For failed calls: the caller should NOT call this function. Failed provider
 * attempts are logged by the LLM layer's recordLLMCall for platform cost
 * analysis, but users are only charged for successful use.
 */
export async function chargeLlmUsage(
  input: LlmBillingInput,
): Promise<LlmBillingResult> {
  const cost = calculateLlmCost({
    provider: input.provider,
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    isByok: input.isByok,
    littAliasId: input.littAliasId,
  });

  // BYOK: no charge, but record for audit
  if (!cost.shouldDebit || cost.retailLiTTBits === 0) {
    await recordUsage(input, cost, null, false);
    return {
      calculated: cost.retailLiTTBits > 0 || input.isByok,
      cost,
      debited: false,
      balance: null,
      replayed: false,
    };
  }

  // Owner billing exemption: meter usage but skip wallet debit.
  // The owner is exempt UNLESS they're simulating a customer tier
  // (starter/creator_beta/pro_builder_beta/zero_bits) — in that case
  // they exercise the real billing path.
  const exempt = isBillingExempt(input.clerkId, input.simulation);
  if (exempt) {
    await recordUsage(input, cost, null, false);
    return {
      calculated: true,
      cost,
      debited: false,
      balance: null,
      replayed: false,
    };
  }

  // Shadow mode: calculate + record, no debit
  if (isShadowMode()) {
    await recordUsage(input, cost, null, false);
    return {
      calculated: true,
      cost,
      debited: false,
      balance: null,
      replayed: false,
    };
  }

  // Real debit
  const admin = getSupabaseAdmin();
  if (!admin) {
    // No DB in dev — don't block
    if (process.env.NODE_ENV !== "production") {
      return {
        calculated: true,
        cost,
        debited: false,
        balance: null,
        replayed: false,
      };
    }
    return {
      calculated: true,
      cost,
      debited: false,
      balance: null,
      replayed: false,
      error: "Billing service unavailable",
    };
  }

  // Resolve internal user ID
  const { data: user } = await admin
    .from("users")
    .select("id")
    .eq("clerk_id", input.clerkId)
    .maybeSingle();

  if (!user) {
    return {
      calculated: true,
      cost,
      debited: false,
      balance: null,
      replayed: false,
      error: "User not found",
    };
  }

  const idempotencyKey = `llm:${input.callId}`;
  const { data, error } = await admin.rpc("debit_credits", {
    p_user_id: user.id,
    p_amount: cost.retailLiTTBits,
    p_category: "usage",
    p_description: `LLM: ${input.provider}/${input.model}`,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    // Record the failed debit attempt
    await recordUsage(input, cost, null, false);
    return {
      calculated: true,
      cost,
      debited: false,
      balance: null,
      replayed: false,
      error: error.message,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const balance = Number(row?.remaining ?? row?.total_after ?? 0);
  const replayed = row?.success === false && balance > 0;

  // Insufficient balance
  if (row?.success === false && balance < cost.retailLiTTBits) {
    await recordUsage(input, cost, balance, false);
    return {
      calculated: true,
      cost,
      debited: false,
      balance,
      replayed: false,
      error: "Insufficient LiTTBits",
    };
  }

  await recordUsage(input, cost, balance, true);

  return {
    calculated: true,
    cost,
    debited: true,
    balance,
    replayed,
  };
}

/**
 * Persist a usage record for platform cost analysis and margin verification.
 * This is best-effort — failures here must never block the billing flow.
 */
async function recordUsage(
  input: LlmBillingInput,
  cost: CostCalculation,
  balanceAfter: number | null,
  wasDebited: boolean,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;

    const exempt = isBillingExempt(input.clerkId, input.simulation);

    await admin.from("llm_usage_records").insert({
      clerk_id: input.clerkId,
      provider: input.provider,
      model: input.model,
      prompt_tokens: input.promptTokens,
      completion_tokens: input.completionTokens,
      litt_alias_id: input.littAliasId ?? null,
      is_byok: input.isByok,
      billing_class: cost.billingClass,
      provider_cost_micros: cost.providerCostMicros,
      retail_littbits: cost.retailLiTTBits,
      platform_margin: cost.platformMargin,
      shadow_mode: cost.shadowMode,
      was_debited: wasDebited,
      balance_after: balanceAfter,
      call_id: input.callId,
      billing_exempt: exempt,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort: usage recording must never break billing
  }
}
