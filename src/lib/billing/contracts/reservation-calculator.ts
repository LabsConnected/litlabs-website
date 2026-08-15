/**
 * Reservation lifecycle calculator — pure functions for testing
 * accounting invariants without a database.
 *
 * These functions operate on in-memory ledger entry arrays and
 * reservation records. They are used by the B1 invariant tests to
 * prove that the accounting model is correct.
 */

import type { Bits } from "./monetary";
import type {
  LedgerEntry,
  Reservation,
  BalanceProjection,
  CreditBucket,
} from "./ledger";

/**
 * Project a balance from a list of ledger entries.
 *
 *   economicBalance = totalGranted - totalSettled - totalExpired ± adjustments
 *   availableBalance = economicBalance - totalHeld
 *
 * This is the canonical balance calculation. The database `get_user_balances`
 * RPC should eventually be replaced by this logic (or vice versa — they must agree).
 */
export function projectBalance(
  userId: string,
  entries: LedgerEntry[],
  reservations: Reservation[],
): BalanceProjection {
  const userEntries = entries.filter((e) => e.userId === userId);
  const userReservations = reservations.filter(
    (r) => r.userId === userId && r.status === "PENDING",
  );

  const allBuckets: CreditBucket[] = [
    "monthly",
    "purchased",
    "beta_promotional",
    "compensation",
    "enterprise_commit",
    "admin",
  ];

  const buckets: BalanceProjection["buckets"] = {} as BalanceProjection["buckets"];

  let totalGranted = 0;
  let totalSettled = 0;
  let totalExpired = 0;
  let totalAdjustments = 0;

  for (const bucket of allBuckets) {
    const bucketEntries = userEntries.filter((e) => e.bucket === bucket);

    let granted = 0;
    let settled = 0;
    let held = 0;
    let expired = 0;

    for (const entry of bucketEntries) {
      if (entry.direction === "credit") {
        switch (entry.type) {
          case "GRANT":
          case "PURCHASE":
          case "PROMO":
          case "REFUND":
            granted += entry.amount;
            break;
          case "RELEASE":
            // Release returns held funds — not a new grant
            break;
          case "ADJUSTMENT":
            // Adjustments are tracked separately, NOT in granted
            totalAdjustments += entry.amount;
            break;
          case "EXPIRATION":
            // Expiration credits don't make sense — skip
            break;
          case "RESERVE":
          case "SETTLE":
            // These are debit-side only
            break;
        }
      } else {
        // debit
        switch (entry.type) {
          case "SETTLE":
            settled += entry.amount;
            break;
          case "RESERVE":
            held += entry.amount;
            break;
          case "RELEASE":
            held -= entry.amount;
            break;
          case "EXPIRATION":
            expired += entry.amount;
            break;
          case "ADJUSTMENT":
            // Adjustments are tracked separately, NOT in granted
            totalAdjustments -= entry.amount;
            break;
          case "REFUND":
            // Refund as debit = reversal of prior charge
            settled -= entry.amount;
            break;
          case "GRANT":
          case "PURCHASE":
          case "PROMO":
            // These are credit-side only
            break;
        }
      }
    }

    // Held from pending reservations
    const reservationHeld = userReservations
      .filter((r) => r.estimatedBits > 0)
      .reduce((sum, r) => sum + r.estimatedBits, 0);

    // For bucket-level held, we need to know which bucket the reservation
    // drew from. For simplicity in B1, we track held at the total level
    // and distribute it proportionally. In production, the reservation
    // records which buckets were debited.
    const bucketAvailable = Math.max(0, granted - settled - expired) - held;

    buckets[bucket] = {
      granted,
      settled,
      held,
      available: Math.max(0, bucketAvailable),
      expired,
    };

    totalGranted += granted;
    totalSettled += settled;
    totalExpired += expired;
  }

  // Total held from pending reservations (not from ledger entries)
  const totalHeld = userReservations.reduce(
    (sum, r) => sum + r.estimatedBits,
    0,
  );

  const economicBalance = Math.max(
    0,
    totalGranted + totalAdjustments - totalSettled - totalExpired,
  );
  const availableBalance = Math.max(0, economicBalance - totalHeld);

  return {
    userId,
    totalGranted,
    totalSettled,
    totalExpired,
    totalAdjustments,
    totalHeld,
    economicBalance,
    availableBalance,
    buckets,
  };
}

/**
 * Simulate a reservation on a balance.
 *
 * Returns the new available balance after holding the estimated amount.
 * Does NOT mutate the input — returns a new projection.
 */
export function simulateReservation(
  balance: BalanceProjection,
  estimatedBits: Bits,
): { canReserve: boolean; availableAfter: Bits } {
  const canReserve = balance.availableBalance >= estimatedBits;
  const availableAfter = canReserve
    ? balance.availableBalance - estimatedBits
    : balance.availableBalance;
  return { canReserve, availableAfter };
}

/**
 * Simulate a settlement on a balance.
 *
 *   actualBits ≤ estimatedBits → settle actual, release (estimated - actual)
 *   actualBits > estimatedBits → settle actual (extra drawn from available)
 *
 * Returns the new balance after settlement.
 */
export function simulateSettlement(
  balance: BalanceProjection,
  estimatedBits: Bits,
  actualBits: Bits,
): BalanceProjection {
  const settled = Math.min(actualBits, estimatedBits);
  const released = Math.max(0, estimatedBits - actualBits);
  const extraDrawn = Math.max(0, actualBits - estimatedBits);

  return {
    ...balance,
    totalSettled: balance.totalSettled + settled + extraDrawn,
    totalHeld: Math.max(0, balance.totalHeld - estimatedBits),
    availableBalance: Math.max(
      0,
      balance.economicBalance - balance.totalSettled - settled - extraDrawn,
    ),
  };
}

/**
 * Simulate a release (cancellation) on a balance.
 *
 * All held funds return to available. No settlement occurs.
 */
export function simulateRelease(
  balance: BalanceProjection,
  estimatedBits: Bits,
): BalanceProjection {
  return {
    ...balance,
    totalHeld: Math.max(0, balance.totalHeld - estimatedBits),
    availableBalance: balance.availableBalance + estimatedBits,
  };
}

/**
 * Simulate two concurrent reservations against the same balance.
 *
 * This is the core concurrency-safety test. If both reservations
 * check `availableBalance >= estimated` before either debits,
 * they can overspend. The fix is atomic locking (advisory lock).
 *
 * This function demonstrates the BUG (non-atomic check-then-act):
 */
export function simulateConcurrentReservationsUnsafe(
  balance: BalanceProjection,
  est1: Bits,
  est2: Bits,
): { bothSucceed: boolean; overspent: boolean; availableAfter: Bits } {
  // BUG: both check against the same initial balance
  const can1 = balance.availableBalance >= est1;
  const can2 = balance.availableBalance >= est2;
  const bothSucceed = can1 && can2;
  const availableAfter = bothSucceed
    ? balance.availableBalance - est1 - est2
    : balance.availableBalance;
  const overspent = bothSucceed && availableAfter < 0;
  return { bothSucceed, overspent, availableAfter };
}

/**
 * Simulate two concurrent reservations with atomic locking.
 *
 * This is the CORRECT behavior: the second reservation sees the
 * balance AFTER the first reservation has already held funds.
 */
export function simulateConcurrentReservationsSafe(
  balance: BalanceProjection,
  est1: Bits,
  est2: Bits,
): { bothSucceed: boolean; overspent: boolean; availableAfter: Bits } {
  // SAFE: first reservation holds, second sees reduced balance
  const after1 = simulateReservation(balance, est1);
  if (!after1.canReserve) {
    return { bothSucceed: false, overspent: false, availableAfter: balance.availableBalance };
  }
  const after2 = simulateReservation(
    { ...balance, availableBalance: after1.availableAfter, totalHeld: balance.totalHeld + est1 },
    est2,
  );
  const bothSucceed = after2.canReserve;
  const availableAfter = bothSucceed
    ? after2.availableAfter
    : after1.availableAfter;
  const overspent = false; // never overspends with locking
  return { bothSucceed, overspent, availableAfter };
}
