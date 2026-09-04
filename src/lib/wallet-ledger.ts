import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

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
    // Starter plan: 500 BITS granted ONCE at account creation, not monthly.
    // The idempotency key is user-scoped (no period) so the grant_credits
    // RPC is a no-op on every subsequent call after the first successful one.
    // We also pre-check the ledger to avoid an unnecessary RPC round-trip
    // on the common path where the grant already exists.
    const { data: existingGrant } = await admin
      .from("credit_ledger")
      .select("id")
      .eq("user_id", userId)
      .eq("idempotency_key", `starter:${userId}`)
      .limit(1)
      .maybeSingle();
    if (!existingGrant) {
      const { error: grantError } = await admin.rpc("grant_credits", {
        p_user_id: userId,
        p_amount: 500,
        p_category: "subscription_grant",
        p_balance_bucket: "monthly",
        p_description: "Starter one-time grant — 500 LiTTBits",
        p_idempotency_key: `starter:${userId}`,
        p_reference_type: "starter_plan",
        p_reference_id: "one_time",
      });
      if (grantError) {
        throw new Error(`Starter credit grant failed: ${grantError.message}`);
      }
    }
  }
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
  return {
    balance,
    previousBalance: before.total,
    // For debits: debit_credits returns success=true even on idempotent replay,
    // but the balance doesn't change. Detect replay by checking if the debit
    // was a no-op (balance unchanged AND success=true AND amount > 0).
    // For grants: grant_credits returns granted=false on replay.
    replayed: isDebit
      ? row.success === true && balance === before.total && Math.abs(params.amount) > 0
      : row.granted === false,
  };
}
