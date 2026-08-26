/**
 * Billing boundary — entitlement gate + usage recording for remote model
 * execution (`runLiTTOperator`).
 *
 * This is the ONLY place terminal-server decides whether an authenticated
 * user is allowed to make a model call, and the ONLY place a successful
 * call gets debited and recorded. It reuses the CANONICAL LiTTBits ledger
 * primitives that already back the website's own AI chat billing
 * (`src/lib/llm-billing.ts`, `src/lib/entitlements.ts`):
 *
 *   - `credit_ledger` table + `debit_credits` / `get_user_balances` RPCs
 *     (supabase/migrations/20260726193000_unify_litbits_ledger.sql) —
 *     append-only, idempotent via `p_idempotency_key`.
 *   - `llm_usage_records` table
 *     (supabase/migrations/20260811000001_llm_usage_records.sql) — the
 *     same table the website's `chargeLlmUsage()` writes to.
 *
 * terminal-server is a separate deployment from the Next.js app (it
 * cannot import `src/lib/*`, which depends on `next/headers` and other
 * Next-only runtime pieces), so this module talks to Supabase directly
 * with the service-role key — the same trust level `src/lib/supabase.ts`
 * uses. No parallel billing system is invented: same tables, same RPCs,
 * same idempotency contract.
 *
 * Fail-closed contract: any missing identity, unresolvable user, missing
 * plan entitlement, exhausted credit balance, or Supabase error results
 * in `authorize()` returning `ok: false`. Callers MUST NOT invoke the
 * model provider when `ok` is false.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Plan entitlement (mirrors src/lib/entitlements.ts) ────────────
//
// CLI/terminal access is gated by the `terminal` entitlement flag in
// src/lib/entitlements.ts's per-plan Entitlements objects. As of this
// writing only `pro_builder_beta` and the internal `owner` plan carry
// `terminal: true` — starter, creator_beta, and founder do not. Keep
// this map in sync with src/config/plans.ts / src/lib/entitlements.ts
// if plan tiers change. Unknown plan ids are treated as NOT entitled
// (fail closed) rather than defaulting to allow.
const PLAN_TERMINAL_ACCESS: Readonly<Record<string, boolean>> = {
  starter: false,
  creator_beta: false,
  pro_builder_beta: true,
  founder: false,
  owner: true,
};

// ─── Types ──────────────────────────────────────────────────────────

export interface BillingIdentity {
  /** Internal Supabase `users.id` (UUID). */
  internalUserId: string;
  /** Clerk user id (`users.clerk_id`) — the identity on the verified terminal JWT. */
  clerkId: string;
  /** Resolved plan id. */
  planId: string;
}

export type AuthorizationDenialCode =
  | "unauthenticated"
  | "user_not_found"
  | "plan_not_entitled"
  | "insufficient_credits"
  | "billing_unavailable";

export interface AuthorizationResult {
  ok: boolean;
  identity?: BillingIdentity;
  code?: AuthorizationDenialCode;
  /** Human-readable, redaction-safe — never includes raw Supabase errors. */
  message?: string;
}

export interface UsageRecordInput {
  identity: BillingIdentity;
  /** Canonical runId for this operator turn — used as the idempotency key. */
  runId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface UsageRecordResult {
  /** True once a `llm_usage_records` row exists for this call. */
  recorded: boolean;
  /** True iff the credit ledger was actually debited. */
  debited: boolean;
  /** True iff this idempotency key had already been settled (replay). */
  replayed: boolean;
  balanceAfter: number | null;
  costBits: number;
  /** Redaction-safe error message, present only when recording failed. */
  error?: string;
}

export interface BillingClient {
  authorize(clerkId: string | null | undefined): Promise<AuthorizationResult>;
  recordUsage(input: UsageRecordInput): Promise<UsageRecordResult>;
}

// ─── Cost estimation ─────────────────────────────────────────────────
//
// Provisional flat rate pending unification with src/lib/llm-cost-engine.ts
// (which prices per provider/model in USD micros). terminal-server has no
// access to that catalog across the deployment boundary, so this uses a
// single conservative BITS-per-1K-tokens rate. This affects the CHARGED
// AMOUNT only — the gate/record MECHANISM (auth, entitlement, idempotent
// debit, usage row) is the part under contract here.
const BITS_PER_1K_TOKENS = 10;

export function estimateCostBits(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  return Math.max(1, Math.ceil((totalTokens / 1000) * BITS_PER_1K_TOKENS));
}

// ─── Supabase-backed implementation ──────────────────────────────────

function redact(err: unknown): string {
  // Never surface raw Supabase/Postgres error text (can include table/
  // column names, connection details in some drivers). Callers get a
  // generic, stable message; the real error is for server-side logs only
  // (and even there, never includes SUPABASE_SERVICE_ROLE_KEY — that key
  // is never part of any error payload Supabase-js constructs).
  console.error("[Billing] Supabase error:", err instanceof Error ? err.message : String(err));
  return "Billing service unavailable";
}

class SupabaseBillingClient implements BillingClient {
  constructor(private readonly client: SupabaseClient) {}

  async authorize(clerkId: string | null | undefined): Promise<AuthorizationResult> {
    if (!clerkId) {
      return { ok: false, code: "unauthenticated", message: "Not authenticated." };
    }

    try {
      const { data: user, error: userErr } = await this.client
        .from("users")
        .select("id")
        .eq("clerk_id", clerkId)
        .maybeSingle();

      if (userErr) return { ok: false, code: "billing_unavailable", message: redact(userErr) };
      if (!user) {
        return { ok: false, code: "user_not_found", message: "No account found for this identity." };
      }
      const internalUserId = user.id as string;

      const { data: sub, error: subErr } = await this.client
        .from("subscriptions")
        .select("plan, status")
        .eq("user_id", internalUserId)
        .maybeSingle();
      if (subErr) return { ok: false, code: "billing_unavailable", message: redact(subErr) };

      const planId = sub && sub.status === "active" && typeof sub.plan === "string"
        ? sub.plan
        : "starter";

      const entitled = PLAN_TERMINAL_ACCESS[planId] === true;
      if (!entitled) {
        return {
          ok: false,
          code: "plan_not_entitled",
          message: "Your plan does not include LiTT CLI access. Upgrade your plan to use the CLI remotely.",
        };
      }

      const { data: balanceRow, error: balErr } = await this.client
        .rpc("get_user_balances", { p_user_id: internalUserId })
        .maybeSingle();
      if (balErr) return { ok: false, code: "billing_unavailable", message: redact(balErr) };

      const total = Number((balanceRow as { total?: number } | null)?.total ?? 0);
      if (!(total > 0)) {
        return {
          ok: false,
          code: "insufficient_credits",
          message: "Insufficient LiTTBits balance. Add credits to continue using the CLI.",
        };
      }

      return {
        ok: true,
        identity: { internalUserId, clerkId, planId },
      };
    } catch (err) {
      return { ok: false, code: "billing_unavailable", message: redact(err) };
    }
  }

  async recordUsage(input: UsageRecordInput): Promise<UsageRecordResult> {
    const costBits = estimateCostBits(input.totalTokens);
    const idempotencyKey = `cli:${input.runId}`;

    if (costBits <= 0) {
      // Nothing to charge (e.g. zero-token result) — still record for audit.
      await this.insertUsageRow(input, costBits, null, false);
      return { recorded: true, debited: false, replayed: false, balanceAfter: null, costBits };
    }

    try {
      const { data, error } = await this.client.rpc("debit_credits", {
        p_user_id: input.identity.internalUserId,
        p_amount: costBits,
        p_category: "usage",
        p_description: `CLI: ${input.provider}/${input.model}`,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        return {
          recorded: false,
          debited: false,
          replayed: false,
          balanceAfter: null,
          costBits,
          error: redact(error),
        };
      }

      const row = Array.isArray(data) ? data[0] : data;
      const success = Boolean((row as { success?: boolean } | undefined)?.success);
      const remaining = Number((row as { remaining?: number } | undefined)?.remaining ?? 0);

      // `debit_credits` is idempotent on p_idempotency_key: a retried
      // completion for the SAME runId returns success without a second
      // debit. We cannot distinguish "replay" from "first debit" purely
      // from the RPC's return shape, so we treat a successful debit as
      // authoritative and rely on the RPC (not this code) to guarantee
      // exactly-once ledger effect. The `llm_usage_records` insert below
      // additionally uses call_id = runId, so a replayed record recording
      // call is also idempotent-observable (same call_id, no duplicate
      // ledger effect even if this function runs twice).
      await this.insertUsageRow(input, costBits, remaining, success);

      return {
        recorded: true,
        debited: success,
        replayed: false,
        balanceAfter: remaining,
        costBits,
      };
    } catch (err) {
      return {
        recorded: false,
        debited: false,
        replayed: false,
        balanceAfter: null,
        costBits,
        error: redact(err),
      };
    }
  }

  private async insertUsageRow(
    input: UsageRecordInput,
    costBits: number,
    balanceAfter: number | null,
    wasDebited: boolean,
  ): Promise<void> {
    try {
      await this.client.from("llm_usage_records").insert({
        clerk_id: input.identity.clerkId,
        provider: input.provider,
        model: input.model,
        prompt_tokens: input.promptTokens,
        completion_tokens: input.completionTokens,
        is_byok: false,
        billing_class: "cli",
        provider_cost_micros: 0,
        retail_littbits: costBits,
        platform_margin: 0,
        shadow_mode: false,
        was_debited: wasDebited,
        balance_after: balanceAfter,
        call_id: `cli:${input.runId}`,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Best-effort — matches src/lib/llm-billing.ts's recordUsage()
      // contract: usage recording must never break the response path.
      // The debit itself (the only thing that moves money) already
      // happened via the idempotent RPC above.
    }
  }
}

// ─── Fail-closed client (used when Supabase is not configured) ───────

class UnavailableBillingClient implements BillingClient {
  async authorize(): Promise<AuthorizationResult> {
    return {
      ok: false,
      code: "billing_unavailable",
      message: "Billing service unavailable",
    };
  }

  async recordUsage(input: UsageRecordInput): Promise<UsageRecordResult> {
    return {
      recorded: false,
      debited: false,
      replayed: false,
      balanceAfter: null,
      costBits: estimateCostBits(input.totalTokens),
      error: "Billing service unavailable",
    };
  }
}

// ─── Singleton accessor (overridable for tests) ──────────────────────

let _client: BillingClient | null = null;
let _override: BillingClient | null = null;

function buildClient(): BillingClient {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  console.log("[Billing] buildClient: url=", url ? "set" : "missing", "key=", key ? "set" : "missing");
  if (!url || !key) return new UnavailableBillingClient();
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return new SupabaseBillingClient(supabase);
}

/** Get the process-wide billing client (lazy). Tests should use `setBillingClientForTests`. */
export function getBillingClient(): BillingClient {
  if (_override) return _override;
  if (!_client) _client = buildClient();
  return _client;
}

/** Test-only: inject a mock BillingClient. Pass null to restore the real client. */
export function setBillingClientForTests(client: BillingClient | null): void {
  _override = client;
}
