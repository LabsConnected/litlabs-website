import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

export type WalletAdjustment = {
  balance: number;
  previousBalance: number;
  replayed: boolean;
};

export async function adjustWalletBalance(params: {
  clerkId: string;
  amount: number;
  type: "earn" | "spend" | "refund" | "correction" | "purchase";
  reason: string;
  idempotencyKey: string;
}): Promise<WalletAdjustment> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Wallet service is not configured");

  const { data, error } = await admin.rpc("adjust_wallet_balance", {
    p_clerk_id: params.clerkId,
    p_amount: params.amount,
    p_type: params.type,
    p_description: params.reason,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) throw new Error(`Wallet adjustment failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.balance !== "number") {
    throw new Error("Wallet adjustment returned an invalid result");
  }
  return {
    balance: row.balance,
    previousBalance: Number(row.previous_balance ?? row.balance - params.amount),
    replayed: Boolean(row.replayed),
  };
}
