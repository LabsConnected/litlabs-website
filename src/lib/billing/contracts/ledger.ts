/**
 * Canonical ledger entry types and reservation lifecycle.
 *
 * `credit_ledger` is the single authoritative customer balance journal.
 * All future mutations must flow through this ledger.
 *
 * The `users.credits` column must NEVER independently mutate customer value
 * after migration. It may become a derived cache or be removed entirely.
 *
 * ── Reservation lifecycle ──
 *
 *   AVAILABLE
 *      ↓ reserve
 *   HELD
 *      ↓
 *   ┌───────────────┐
 *   settle       release
 *   ↓                ↓
 *   SPENT        AVAILABLE
 *
 * Reservations are atomic and concurrency-safe.
 * An unused reservation is NEVER modeled as a customer REFUND.
 * It is a RELEASE — the held funds return to available without
 * a refund journal entry.
 */

import type { Bits, UsdMicros, BasisPoints } from "./monetary";

// ── Ledger entry types ─────────────────────────────────────────────────

/**
 * Every type of mutation that can appear in the credit ledger.
 *
 * CREDIT-side entries (increase available balance):
 *   GRANT          — subscription or promotional grant
 *   PURCHASE       — customer bought BITS
 *   PROMO          — promotional/marketing grant
 *   REFUND         — reversal of a prior SETTLE (customer-facing refund)
 *   ADJUSTMENT     — manual correction (admin)
 *   RELEASE        — reservation released back to available
 *   EXPIRATION     — expired credits removed (technically a debit, but tracked)
 *
 * DEBIT-side entries (decrease available balance):
 *   RESERVE        — funds held for pending execution
 *   SETTLE         — reserved funds converted to final spend
 *   EXPIRATION     — expired credits removed
 *   ADJUSTMENT     — manual correction (admin)
 *
 * The `direction` field on the ledger row determines credit vs debit.
 * Some types can appear in both directions (ADJUSTMENT, EXPIRATION).
 */
export type LedgerEntryType =
  | "GRANT"
  | "PURCHASE"
  | "PROMO"
  | "RESERVE"
  | "SETTLE"
  | "RELEASE"
  | "REFUND"
  | "ADJUSTMENT"
  | "EXPIRATION";

/**
 * Credit bucket — determines consumption priority and expiration behavior.
 *
 * Current buckets (from existing schema):
 *   monthly          — subscription grants, expire at period end
 *   purchased        — one-time purchases, no expiration
 *   beta_promotional — beta/test credits, may expire
 *
 * Future buckets (not yet implemented):
 *   compensation       — service credit for failures
 *   enterprise_commit  — contracted usage
 *   admin              — manual correction
 */
export type CreditBucket =
  | "monthly"
  | "purchased"
  | "beta_promotional"
  | "compensation"
  | "enterprise_commit"
  | "admin";

/**
 * Canonical ledger entry.
 *
 * This is the contract for every row in `credit_ledger` (extended).
 * Every monetary mutation produces exactly one ledger entry.
 * Entries are immutable after creation.
 */
export interface LedgerEntry {
  /** Immutable unique transaction ID. */
  entryId: string;
  /** User/account ID (internal Supabase UUID). */
  userId: string;
  /** Amount in BITS. Always positive. Direction determines credit/debit. */
  amount: Bits;
  /** Credit or debit. */
  direction: "credit" | "debit";
  /** Entry type (see LedgerEntryType). */
  type: LedgerEntryType;
  /** Credit bucket affected. */
  bucket: CreditBucket;
  /** Human-readable reason. */
  reason: string;
  /** Idempotency key — duplicate submissions are no-ops. */
  idempotencyKey: string;
  /** Correlation: run ID (if associated with a run). */
  runId: string | null;
  /** Correlation: usage event ID (if associated with a usage event). */
  usageEventId: string | null;
  /** Correlation: reservation ID (if associated with a reservation). */
  reservationId: string | null;
  /** Correlation: grant ID (for per-grant tracking). */
  grantId: string | null;
  /** Pricing version used for this charge (if applicable). */
  pricingVersion: string | null;
  /** Exchange rate version used for this charge (if applicable). */
  exchangeRateVersion: string | null;
  /** Provider cost in micro-USD (if this entry settled a provider charge). */
  providerCostMicros: UsdMicros | null;
  /** Reference type (e.g. "stripe_checkout", "subscription", "usage"). */
  referenceType: string | null;
  /** Reference ID (e.g. Stripe session ID, subscription ID). */
  referenceId: string | null;
  /** Expiration timestamp (for grants with expiration). */
  expiresAt: string | null;
  /** Creation timestamp. */
  createdAt: string;
  /** Arbitrary metadata (JSON). */
  metadata: Record<string, unknown> | null;
}

// ── Reservation lifecycle ──────────────────────────────────────────────

/**
 * Reservation status.
 *
 *   PENDING   — reservation created, funds held
 *   SETTLED   — actual usage measured, funds converted to spend
 *   RELEASED  — reservation cancelled, funds returned to available
 *   EXPIRED   — reservation timed out without settlement
 *   FAILED    — reservation could not be created (insufficient balance)
 */
export type ReservationStatus =
  | "PENDING"
  | "SETTLED"
  | "RELEASED"
  | "EXPIRED"
  | "FAILED";

/**
 * Canonical reservation record.
 *
 * A reservation holds funds before execution. The lifecycle is:
 *
 *   1. Create reservation (RESERVE ledger entry, status=PENDING)
 *   2. Execute the operation
 *   3a. Settle (SETTLE ledger entry for actual, RELEASE for remainder, status=SETTLED)
 *   3b. Release (RELEASE ledger entry for full amount, status=RELEASED)
 *   3c. Expire (RELEASE ledger entry, status=EXPIRED) — if no settlement within timeout
 *
 * Reservations are atomic. Two simultaneous reservations against the same
 * balance cannot overspend.
 */
export interface Reservation {
  /** Immutable unique reservation ID. */
  reservationId: string;
  /** User/account ID. */
  userId: string;
  /** Run ID this reservation is for. */
  runId: string;
  /** Estimated BITS held. */
  estimatedBits: Bits;
  /** Actual BITS settled (null until settlement). */
  actualBits: Bits | null;
  /** BITS released back (null until settlement/release). */
  releasedBits: Bits | null;
  /** Current status. */
  status: ReservationStatus;
  /** Idempotency key. */
  idempotencyKey: string;
  /** Pricing version used for estimation. */
  pricingVersion: string | null;
  /** Exchange rate version used for estimation. */
  exchangeRateVersion: string | null;
  /** Reservation timeout (ISO 8601). After this, auto-expire. */
  expiresAt: string;
  /** Creation timestamp. */
  createdAt: string;
  /** Settlement timestamp (null until settled). */
  settledAt: string | null;
  /** Release timestamp (null until released). */
  releasedAt: string | null;
  /** Billability cause (see billability.ts). */
  billabilityCause: string | null;
  /** Arbitrary metadata. */
  metadata: Record<string, unknown> | null;
}

// ── Balance projection ─────────────────────────────────────────────────

/**
 * Balance projection from the ledger.
 *
 * The balance is ALWAYS a projection of the ledger, never an independently
 * mutable value.
 *
 *   economicBalance = totalGranted - totalSettled - totalExpired ± adjustments
 *   availableBalance = economicBalance - totalHeld (pending reservations)
 */
export interface BalanceProjection {
  userId: string;
  /** Total credits ever granted (sum of all credit-side entries, excluding RELEASE). */
  totalGranted: Bits;
  /** Total debits settled (sum of SETTLE debit entries). */
  totalSettled: Bits;
  /** Total expired credits. */
  totalExpired: Bits;
  /** Total adjustments (net). */
  totalAdjustments: Bits;
  /** Currently held in pending reservations. */
  totalHeld: Bits;
  /** Economic balance = granted - settled - expired + adjustments. */
  economicBalance: Bits;
  /** Available balance = economicBalance - held. */
  availableBalance: Bits;
  /** Per-bucket breakdown. */
  buckets: Record<CreditBucket, {
    granted: Bits;
    settled: Bits;
    held: Bits;
    available: Bits;
    expired: Bits;
  }>;
}

// ── Accounting invariant ───────────────────────────────────────────────

/**
 * The fundamental accounting invariant:
 *
 *   totalGranted + totalPurchased
 *   - totalSettled
 *   ± totalAdjustments
 *   - totalExpired
 *   = economicBalance
 *
 * Reserved funds affect availability but are NOT final spend until settlement.
 *
 * This function validates the invariant for a balance projection.
 * Returns true if the invariant holds, false otherwise.
 */
export function validateAccountingInvariant(
  balance: BalanceProjection,
): boolean {
  const calculated =
    balance.totalGranted +
    balance.totalAdjustments -
    balance.totalSettled -
    balance.totalExpired;
  return calculated === balance.economicBalance;
}

/**
 * Validate that available balance = economic balance - held.
 */
export function validateAvailableBalance(
  balance: BalanceProjection,
): boolean {
  return (
    balance.economicBalance - balance.totalHeld ===
    balance.availableBalance
  );
}

// ── Ledger mutation request ────────────────────────────────────────────

/**
 * Request to append an entry to the ledger.
 * All fields are validated before the entry is written.
 */
export interface LedgerMutationRequest {
  userId: string;
  amount: Bits;
  type: LedgerEntryType;
  bucket: CreditBucket;
  reason: string;
  idempotencyKey: string;
  runId?: string;
  usageEventId?: string;
  reservationId?: string;
  grantId?: string;
  pricingVersion?: string;
  exchangeRateVersion?: string;
  providerCostMicros?: UsdMicros;
  referenceType?: string;
  referenceId?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result of a ledger mutation.
 */
export interface LedgerMutationResult {
  ok: boolean;
  entryId: string | null;
  /** True if this idempotency key was already used (no-op). */
  replayed: boolean;
  /** Balance after the mutation. */
  balanceAfter: Bits | null;
  error?: string;
}

// ── Compatibility with existing schema ─────────────────────────────────

/**
 * Maps existing `credit_ledger.category` values to canonical LedgerEntryType.
 *
 * Existing categories:
 *   subscription_grant → GRANT
 *   beta_grant         → GRANT
 *   purchase           → PURCHASE
 *   usage              → SETTLE (these are direct debits, not reservations)
 *   refund             → REFUND
 *   adjustment         → ADJUSTMENT
 *   promotion          → PROMO
 *
 * Existing direction: 'credit' | 'debit'
 * Existing buckets: 'monthly' | 'purchased' | 'beta_promotional'
 */
export const CATEGORY_TO_ENTRY_TYPE: Record<string, LedgerEntryType> = {
  subscription_grant: "GRANT",
  beta_grant: "GRANT",
  purchase: "PURCHASE",
  usage: "SETTLE",
  refund: "REFUND",
  adjustment: "ADJUSTMENT",
  promotion: "PROMO",
};

/**
 * Maps canonical LedgerEntryType to existing `credit_ledger.category` values
 * for backward compatibility.
 */
export const ENTRY_TYPE_TO_CATEGORY: Record<LedgerEntryType, string> = {
  GRANT: "subscription_grant",
  PURCHASE: "purchase",
  PROMO: "promotion",
  RESERVE: "usage", // legacy: reservations were modeled as usage debits
  SETTLE: "usage",
  RELEASE: "refund", // legacy: releases were modeled as refunds
  REFUND: "refund",
  ADJUSTMENT: "adjustment",
  EXPIRATION: "adjustment", // no existing equivalent
};
