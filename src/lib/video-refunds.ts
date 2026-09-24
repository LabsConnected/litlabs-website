/**
 * Staged video-BITS refund primitives (P1-3).
 *
 * The video generation flow debits up front and refunds on failure:
 *   stage 1 — validation (pre-debit, nothing to refund)
 *   stage 2 — debit, then provider submission (refund on submission failure)
 *   stage 3 — provider accepted, outcome polling (refund on terminal failure)
 *
 * This module owns the money-critical property: every refund is issued
 * through the wallet ledger's idempotency key, so retries — across
 * attempts, polls, instances, or restarts — can credit a user at most
 * once. Refund calls never throw: they retry a bounded number of times
 * and return their outcome so the caller can record it durably
 * (generation_jobs.refund_status) instead of silently losing it.
 */

import { adjustWalletBalance } from "@/lib/wallet-ledger";

export type VideoRefundResult =
  | { ok: true; replayed: boolean }
  | { ok: false; error: string };

const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Issue a video BITS refund with bounded retries.
 *
 * Safe to call any number of times for the same idempotencyKey: the
 * wallet ledger dedupes on the key, so at most one credit is applied.
 * Never throws — returns `{ ok: false }` after exhausting attempts so
 * the caller can persist `refund_status = "pending"` and let a later
 * retry (or poll) complete it.
 */
export async function refundVideoCharge(opts: {
  clerkId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  attempts?: number;
}): Promise<VideoRefundResult> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  let lastError = "unknown error";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await adjustWalletBalance({
        clerkId: opts.clerkId,
        amount: opts.amount,
        type: "refund",
        reason: opts.reason,
        idempotencyKey: opts.idempotencyKey,
      });
      return { ok: true, replayed: res.replayed };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (i < attempts - 1) {
        await sleep(BASE_DELAY_MS * 2 ** i);
      }
    }
  }
  console.error(
    `[video-refunds] refund failed after ${attempts} attempts ` +
      `(key=${opts.idempotencyKey}): ${lastError}`,
  );
  return { ok: false, error: lastError };
}
