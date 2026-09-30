import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  PLAN_ENTITLEMENTS,
  STARTER_GRANT_KEY_PREFIX,
  STARTER_TOPUP_KEY_PREFIX,
  STARTER_TOPUP_BITS,
  LEGACY_STARTER_GRANT_KEY_PREFIX,
} from "@/config/plan-entitlements";
import {
  recordChargeEvidence,
  type ChargeRating,
  type ChargeUsage,
} from "@/lib/billing/canonical-pricing";

export type WalletAdjustment = {
  balance: number;
  previousBalance: number;
  replayed: boolean;
};

export type CreditBalances = {
  monthly: number;
  purchased: number;
  betaPromotional: number;
  total: number;
  lastDailyClaim: string | null;
};

async function getUserId(clerkId: string): Promise<string> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Wallet service is not configured");
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  if (error || !data?.id) throw new Error("Wallet user was not found");
  return data.id;
}

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/**
 * One-time legacy Starter top-up. Accounts holding only the pre-v1 500-bit
 * grant (`starter:{userId}`) receive +1,000 bits so their lifetime Starter
 * grant equals the locked 1,500 — never a second full grant.
 *
 * Skipped when the account already has the v1 grant or a prior top-up.
 * Fully idempotent: the `starter:topup-v1:{userId}` key makes re-runs
 * (including concurrent ones) no-ops at the grant_credits RPC layer.
 */
export async function ensureStarterTopUp(
  admin: SupabaseAdmin,
  userId: string,
): Promise<{ toppedUp: boolean }> {
  const topUpKey = `${STARTER_TOPUP_KEY_PREFIX}${userId}`;
  const starterKey = `${STARTER_GRANT_KEY_PREFIX}${userId}`;

  const { data: existing } = await admin
    .from("credit_ledger")
    .select("idempotency_key")
    .eq("user_id", userId)
    .in("idempotency_key", [topUpKey, starterKey])
    .limit(2);
  if (existing && existing.length > 0) return { toppedUp: false };

  const { data: legacyGrant } = await admin
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("idempotency_key", `${LEGACY_STARTER_GRANT_KEY_PREFIX}${userId}`)
    .limit(1)
    .maybeSingle();
  if (!legacyGrant) return { toppedUp: false };

  const { error: topUpError } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: STARTER_TOPUP_BITS,
    p_category: "subscription_grant",
    p_balance_bucket: "monthly",
    p_description: `Starter grant top-up — ${STARTER_TOPUP_BITS} LiTTBits (legacy 500 → ${PLAN_ENTITLEMENTS.starter.oneTimeGrantBits})`,
    p_idempotency_key: topUpKey,
    p_reference_type: "starter_plan",
    p_reference_id: "one_time_topup",
  });
  if (topUpError) {
    throw new Error(`Starter top-up failed: ${topUpError.message}`);
  }
  return { toppedUp: true };
}

export async function getCreditBalances(clerkId: string): Promise<CreditBalances> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Wallet service is not configured");
  const userId = await getUserId(clerkId);
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .maybeSingle();
  if (!subscription) {
    // Starter plan: one-time grant (PLAN_ENTITLEMENTS.starter.oneTimeGrantBits)
    // at account creation, not monthly. The idempotency key uses the v1
    // namespace (`starter:v1:{userId}`) so it never collides with the legacy
    // `starter:{userId}` 500 grants. The grant_credits RPC is a no-op on every
    // subsequent call after the first successful one. We pre-check the ledger
    // to avoid an unnecessary RPC round-trip on the common path where the
    // grant exists.
    const starterKey = `${STARTER_GRANT_KEY_PREFIX}${userId}`;
    const starterBits = PLAN_ENTITLEMENTS.starter.oneTimeGrantBits;
    const { data: existingGrant } = await admin
      .from("credit_ledger")
      .select("id")
      .eq("user_id", userId)
      .eq("idempotency_key", starterKey)
      .limit(1)
      .maybeSingle();
    if (!existingGrant) {
      const { error: grantError } = await admin.rpc("grant_credits", {
        p_user_id: userId,
        p_amount: starterBits,
        p_category: "subscription_grant",
        p_balance_bucket: "monthly",
        p_description: `Starter one-time grant — ${starterBits} LiTTBits`,
        p_idempotency_key: starterKey,
        p_reference_type: "starter_plan",
        p_reference_id: "one_time",
      });
      if (grantError) {
        throw new Error(`Starter credit grant failed: ${grantError.message}`);
      }
    }
  }
  // Legacy top-up: accounts that only ever received the old 500-bit Starter
  // grant get a one-time +1,000 adjustment so their lifetime Starter grant
  // equals the locked 1,500 — never a second full grant. Runs for paid and
  // free accounts alike (it corrects history, not the current plan) and is
  // idempotent via `starter:topup-v1:{userId}`: re-runs are no-ops.
  await ensureStarterTopUp(admin, userId);
  const [{ data, error }, { data: daily }] = await Promise.all([
    admin.rpc("get_user_balances", { p_user_id: userId }),
    admin
      .from("credit_ledger")
      .select("created_at")
      .eq("user_id", userId)
      .eq("category", "promotion")
      .like("idempotency_key", "daily:%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw new Error(`Wallet balance lookup failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    monthly: Math.max(0, Number(row?.monthly ?? 0)),
    purchased: Math.max(0, Number(row?.purchased ?? 0)),
    betaPromotional: Math.max(0, Number(row?.beta_promotional ?? 0)),
    total: Math.max(0, Number(row?.total ?? 0)),
    lastDailyClaim: daily?.created_at ?? null,
  };
}

export async function adjustWalletBalance(params: {
  clerkId: string;
  amount: number;
  type: "earn" | "spend" | "refund" | "correction" | "purchase";
  reason: string;
  idempotencyKey: string;
  /**
   * Canonical pricing evidence for debits. When provided, the charge is
   * stamped with the pricing version + provider cost and a
   * usage_events/rating_events evidence chain is written. Omit for
   * grants/refunds/adjustments (they are not rated charges).
   */
  rating?: ChargeRating;
  usage?: ChargeUsage;
}): Promise<WalletAdjustment> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Wallet service is not configured");

  const userId = await getUserId(params.clerkId);
  const before = await getCreditBalances(params.clerkId);
  const isDebit = params.amount < 0;
  const { data, error } = isDebit
    ? await admin.rpc("debit_credits", {
        p_user_id: userId,
        p_amount: Math.abs(params.amount),
        p_category: params.type === "refund" ? "refund" : "usage",
        p_description: params.reason,
        p_idempotency_key: params.idempotencyKey,
      })
    : await admin.rpc("grant_credits", {
        p_user_id: userId,
        p_amount: params.amount,
        p_category: params.type === "purchase" ? "purchase" : params.type === "correction" ? "adjustment" : "promotion",
        p_balance_bucket: params.type === "purchase" || params.type === "correction" ? "purchased" : "beta_promotional",
        p_description: params.reason,
        p_idempotency_key: params.idempotencyKey,
      });
  if (error) throw new Error(`Wallet adjustment failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const balance = Number(row?.remaining ?? row?.total_after);
  if (!row || !Number.isFinite(balance)) {
    throw new Error("Wallet adjustment returned an invalid result");
  }
  if (isDebit && row.success === false && balance < Math.abs(params.amount)) {
    throw new Error("Insufficient balance");
  }
  const replayed = isDebit
    ? row.success === true && balance === before.total && Math.abs(params.amount) > 0
    : row.granted === false;

  // Stamp canonical pricing evidence on real (non-replayed) debits.
  if (isDebit && params.rating && !replayed) {
    await recordChargeEvidence(admin, {
      userId,
      idempotencyKey: params.idempotencyKey,
      rating: params.rating,
      usage: params.usage,
    });
  }

  return {
    balance,
    previousBalance: before.total,
    // For debits: debit_credits returns success=true even on idempotent replay,
    // but the balance doesn't change. Detect replay by checking if the debit
    // was a no-op (balance unchanged AND success=true AND amount > 0).
    // For grants: grant_credits returns granted=false on replay.
    replayed,
  };
}
