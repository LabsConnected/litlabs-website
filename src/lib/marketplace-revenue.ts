// Marketplace Revenue Split — creator/platform revenue sharing.
//
// When a customer uses a premium Marketplace agent/model, the revenue is
// split between the creator and LiTTree after deducting underlying provider
// costs:
//
//   Customer charge:       100 BITS-equivalent
//   Provider cost:          40
//   Net value:              60
//
//   Creator gets:           45  (75% of net)
//   LiTTree gets:           15  (25% of net)
//
// If the creator uses their own infrastructure/API key, LiTTree's 25%
// platform fee is cleaner because we aren't carrying their inference bill.
//
// Creator payouts are tracked in a separate ledger from the user wallet
// (LiTTBits) — this is real money owed to creators, not internal credits.

import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

export const CREATOR_SHARE_PERCENT = 0.75;
export const PLATFORM_SHARE_PERCENT = 0.25;

export interface RevenueSplitInput {
  /** The marketplace agent ID */
  agentId: string;
  /** The creator's internal user ID */
  creatorUserId: string;
  /** The customer's clerk ID */
  customerClerkId: string;
  /** The amount charged to the customer in LiTTBits */
  customerChargeBits: number;
  /** The underlying provider cost in LiTTBits-equivalent */
  providerCostBits: number;
  /** Unique transaction ID for idempotency */
  transactionId: string;
}

export interface RevenueSplitResult {
  /** Net revenue after provider cost */
  netRevenue: number;
  /** Creator's share (75% of net) */
  creatorShare: number;
  /** LiTTree's share (25% of net) */
  platformShare: number;
  /** Whether the split was recorded */
  recorded: boolean;
  /** Error message if recording failed */
  error?: string;
}

/**
 * Calculate and record a marketplace revenue split.
 *
 * The split operates on NET revenue (after underlying provider cost).
 * If the creator uses their own infrastructure, providerCostBits should be 0,
 * making the split cleaner.
 */
export async function recordRevenueSplit(
  input: RevenueSplitInput,
): Promise<RevenueSplitResult> {
  const netRevenue = Math.max(0, input.customerChargeBits - input.providerCostBits);
  const creatorShare = Math.round(netRevenue * CREATOR_SHARE_PERCENT);
  const platformShare = netRevenue - creatorShare;

  const result: RevenueSplitResult = {
    netRevenue,
    creatorShare,
    platformShare,
    recorded: false,
  };

  try {
    const admin = getSupabaseAdmin();
    if (!admin) {
      if (process.env.NODE_ENV !== "production") {
        return { ...result, recorded: false };
      }
      return { ...result, recorded: false, error: "Database unavailable" };
    }

    // Record in the creator payout ledger (separate from user wallet)
    await admin.from("creator_payout_ledger").insert({
      agent_id: input.agentId,
      creator_user_id: input.creatorUserId,
      customer_clerk_id: input.customerClerkId,
      customer_charge_bits: input.customerChargeBits,
      provider_cost_bits: input.providerCostBits,
      net_revenue: netRevenue,
      creator_share: creatorShare,
      platform_share: platformShare,
      transaction_id: input.transactionId,
      created_at: new Date().toISOString(),
    });

    result.recorded = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Recording failed";
  }

  return result;
}

/**
 * Calculate the expected split without recording it (for display/preview).
 */
export function calculateRevenueSplit(
  customerChargeBits: number,
  providerCostBits: number,
): { netRevenue: number; creatorShare: number; platformShare: number } {
  const netRevenue = Math.max(0, customerChargeBits - providerCostBits);
  const creatorShare = Math.round(netRevenue * CREATOR_SHARE_PERCENT);
  const platformShare = netRevenue - creatorShare;
  return { netRevenue, creatorShare, platformShare };
}
