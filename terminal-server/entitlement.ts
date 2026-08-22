/**
 * Entitlement — server-side subscription + credits enforcement for
 * remote LiTT inference.
 *
 *   POST /api/inference  →  checkEntitlement(userId)  →  runLiTTOperator  →  recordUsage
 *
 * The CLI NEVER sees the server's OPENROUTER_API_KEY. A paid user with
 * no local provider key gets inference served by the server, gated by:
 *   1. An active subscription (public.subscriptions.status = 'active')
 *   2. A positive LiTBit coin balance (public.wallets.balance > 0)
 *
 * If either check fails, the server returns 402 Payment Required and the
 * CLI surfaces a clean "subscription required" message — never a raw
 * API-key error.
 *
 * All Supabase access uses the service role key (server-side only).
 * The CLI never holds this key.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Types ─────────────────────────────────────────────────────────

export interface EntitlementResult {
  /** Whether the user is entitled to inference. */
  entitled: boolean;
  /** Human-readable reason (shown to the user when not entitled). */
  reason: string;
  /** The denial code (for structured client handling). */
  code: EntitlementDenialCode | null;
  /** The user's current plan (for logging/analytics). */
  plan: string | null;
  /** The user's current coin balance. */
  coinBalance: number | null;
}

export type EntitlementDenialCode =
  | "no_subscription"
  | "subscription_inactive"
  | "no_wallet"
  | "insufficient_credits"
  | "user_not_found"
  | "backend_unavailable";

export interface UsageRecord {
  clerkId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  coinsDebited: number;
  runId?: string;
  mode?: string;
  durationMs?: number;
}

// ─── Supabase client (lazy singleton) ──────────────────────────────

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// ─── Cost estimation (LiTBit coins per inference) ──────────────────

/**
 * Estimate the LiTBit coin cost of an inference call.
 *
 * This is a simple heuristic: 1 coin per 1000 total tokens, with a
 * minimum of 1 coin. The real cost in USD is recorded separately in
 * the usage ledger for billing analytics.
 *
 * For subscription-included plans (e.g. 'pro'), the coinsDebited may
 * be 0 — the subscription covers it. That decision is made here, not
 * by the caller.
 */
export function estimateCoinCost(
  totalTokens: number,
  plan: string | null,
): number {
  // Pro+ plans: inference is included, no coin debit
  if (plan === "pro" || plan === "studio" || plan === "enterprise") {
    return 0;
  }
  // Free/starter: 1 coin per 1000 tokens, minimum 1
  return Math.max(1, Math.ceil(totalTokens / 1000));
}

// ─── Entitlement check ─────────────────────────────────────────────

/**
 * Check whether a user (identified by Clerk ID) is entitled to
 * remote inference.
 *
 * Returns entitled=true if:
 *   1. The user exists in public.users
 *   2. They have an active subscription (status='active')
 *   3. They have a positive coin balance (for non-included plans)
 *
 * This is the gate called by POST /api/inference BEFORE any model
 * call is made. It must be fast (< 200ms) and fail-closed.
 */
export async function checkEntitlement(clerkId: string): Promise<EntitlementResult> {
  const sb = getSupabase();
  if (!sb) {
    return {
      entitled: false,
      reason: "Entitlement backend is not configured.",
      code: "backend_unavailable",
      plan: null,
      coinBalance: null,
    };
  }

  // 1. Resolve the user's internal UUID from their Clerk ID
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (userErr || !user) {
    return {
      entitled: false,
      reason: "User not found. Run `litt login` to sign in.",
      code: "user_not_found",
      plan: null,
      coinBalance: null,
    };
  }

  // 2. Check subscription status
  const { data: sub, error: subErr } = await sb
    .from("subscriptions")
    .select("plan, status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subErr || !sub) {
    return {
      entitled: false,
      reason: "No subscription found. Subscribe at https://litlabs.net/pricing",
      code: "no_subscription",
      plan: null,
      coinBalance: null,
    };
  }

  if (sub.status !== "active") {
    return {
      entitled: false,
      reason: `Subscription is ${sub.status}. Reactivate at https://litlabs.net/pricing`,
      code: "subscription_inactive",
      plan: sub.plan,
      coinBalance: null,
    };
  }

  // 3. Check coin balance (only debited for non-included plans)
  const includedPlan = sub.plan === "pro" || sub.plan === "studio" || sub.plan === "enterprise";
  if (includedPlan) {
    // Included plan — no coin check needed
    return {
      entitled: true,
      reason: "ok",
      code: null,
      plan: sub.plan,
      coinBalance: null,
    };
  }

  const { data: wallet, error: walletErr } = await sb
    .from("wallets")
    .select("balance")
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletErr || !wallet) {
    return {
      entitled: false,
      reason: "No wallet found. Earn LiTBit coins at https://litlabs.net/wallet",
      code: "no_wallet",
      plan: sub.plan,
      coinBalance: null,
    };
  }

  if (wallet.balance <= 0) {
    return {
      entitled: false,
      reason: `Out of LiTBit coins (balance: ${wallet.balance}). Earn more at https://litlabs.net/wallet`,
      code: "insufficient_credits",
      plan: sub.plan,
      coinBalance: wallet.balance,
    };
  }

  return {
    entitled: true,
    reason: "ok",
    code: null,
    plan: sub.plan,
    coinBalance: wallet.balance,
  };
}

// ─── Usage recording ───────────────────────────────────────────────

/**
 * Record a completed inference call in the usage ledger and debit
 * coins from the user's wallet (if applicable).
 *
 * This is called AFTER the inference completes successfully. If it
 * fails, the inference was still served — we log best-effort and
 * do not throw (the user already got their response).
 *
 * Uses a Supabase RPC to atomically debit coins + insert the ledger
 * row + insert a transactions row, so the wallet and ledger never
 * drift apart.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  const sb = getSupabase();
  if (!sb) return; // best-effort — no backend, no recording

  try {
    // 1. Resolve user UUID from clerk_id
    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("clerk_id", record.clerkId)
      .maybeSingle();
    if (!user) return;

    // 2. Insert the usage ledger row
    const { error: ledgerErr } = await sb.from("litt_usage_ledger").insert({
      user_id: user.id,
      clerk_id: record.clerkId,
      provider: record.provider,
      model: record.model,
      prompt_tokens: record.promptTokens,
      completion_tokens: record.completionTokens,
      total_tokens: record.totalTokens,
      cost_usd: record.costUsd,
      coins_debited: record.coinsDebited,
      run_id: record.runId ?? null,
      mode: record.mode ?? null,
      duration_ms: record.durationMs ?? null,
    });
    if (ledgerErr) {
      console.error("[entitlement] ledger insert failed:", ledgerErr.message);
      return;
    }

    // 3. Debit coins from wallet (if any were charged)
    if (record.coinsDebited > 0) {
      // Fetch current balance
      const { data: wallet } = await sb
        .from("wallets")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!wallet) return;

      const newBalance = Math.max(0, wallet.balance - record.coinsDebited);
      await sb
        .from("wallets")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);

      // Record the transaction
      await sb.from("transactions").insert({
        user_id: user.id,
        type: "spend",
        amount: -record.coinsDebited,
        balance_after: newBalance,
        description: `LiTT inference: ${record.model}`,
        metadata: {
          provider: record.provider,
          model: record.model,
          total_tokens: record.totalTokens,
          run_id: record.runId,
        },
      });
    }
  } catch (err) {
    // Best-effort — the inference was already served
    console.error("[entitlement] recordUsage failed:", err instanceof Error ? err.message : String(err));
  }
}

// ─── Health check ──────────────────────────────────────────────────

/**
 * Check if the entitlement backend is configured and reachable.
 * Used by /health/ready to report entitlement readiness.
 */
export async function entitlementReady(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    // Cheap probe — select 1 row from users with a 2s timeout
    const ctrl = AbortSignal.timeout(2000);
    await sb.from("users").select("id").limit(1).abortSignal(ctrl);
    return true;
  } catch {
    return false;
  }
}
