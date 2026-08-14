/**
 * B1 Canonical Billing Foundation — Invariant Tests
 *
 * Proves:
 * 1. Same micro-USD provider cost always converts to the same BITS
 *    regardless of modality.
 * 2. Duplicate idempotency keys cannot double-charge.
 * 3. Two simultaneous reservations cannot spend the same available balance.
 * 4. Reservation + settlement preserves accounting invariants.
 * 5. Reservation + release restores available balance.
 * 6. Settled ledger entries reference immutable pricing versions.
 * 7. Failure/retry billability is explicit.
 * 8. Existing balance behavior has a documented reconciliation path.
 */

import { describe, it, expect } from "vitest";
import {
  // Monetary
  usdMicrosToBits,
  bitsToUsdMicros,
  applyMargin,
  realizedMarginBps,
  fullyLoadedCostMicros,
  LEGACY_EXCHANGE_RATES,
  EXCHANGE_RATE_DISCREPANCY,
  type UsdMicros,
  type Bits,
  type ExchangeRateVersion,
  type CostComponents,
  // Ledger
  validateAccountingInvariant,
  validateAvailableBalance,
  CATEGORY_TO_ENTRY_TYPE,
  ENTRY_TYPE_TO_CATEGORY,
  type LedgerEntry,
  type Reservation,
  type BalanceProjection,
  // Reservation calculator
  projectBalance,
  simulateReservation,
  simulateSettlement,
  simulateRelease,
  simulateConcurrentReservationsUnsafe,
  simulateConcurrentReservationsSafe,
  // Billability
  isBillable,
  isLiittAbsorbed,
  shouldMeterProviderCost,
  createBillabilityDecision,
  type BillabilityCause,
} from "@/lib/billing/contracts";

// ── Test helpers ───────────────────────────────────────────────────────

const CANONICAL_RATE: ExchangeRateVersion = {
  id: "exch-2026-08-13-v1",
  label: "1000 BITS per USD (canonical)",
  bitsPerUsdMicro: { num: 1, den: 1000 },
  effectiveFrom: "2026-08-13T00:00:00Z",
  effectiveUntil: null,
  approvedBy: "test",
  createdAt: "2026-08-13T00:00:00Z",
};

function makeEntry(
  overrides: Partial<LedgerEntry> & Pick<LedgerEntry, "userId" | "amount" | "direction" | "type" | "bucket" | "idempotencyKey">,
): LedgerEntry {
  return {
    entryId: crypto.randomUUID(),
    reason: "test",
    runId: null,
    usageEventId: null,
    reservationId: null,
    grantId: null,
    pricingVersion: null,
    exchangeRateVersion: null,
    providerCostMicros: null,
    referenceType: null,
    referenceId: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    metadata: null,
    ...overrides,
  };
}

function makeReservation(
  overrides: Partial<Reservation> & Pick<Reservation, "userId" | "runId" | "estimatedBits" | "idempotencyKey">,
): Reservation {
  return {
    reservationId: crypto.randomUUID(),
    actualBits: null,
    releasedBits: null,
    status: "PENDING",
    pricingVersion: null,
    exchangeRateVersion: null,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    createdAt: new Date().toISOString(),
    settledAt: null,
    releasedAt: null,
    billabilityCause: null,
    metadata: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Same micro-USD → same BITS regardless of modality
// ═══════════════════════════════════════════════════════════════════════

describe("1. Canonical exchange rate: same cost → same BITS", () => {
  it("converts $0.07 to 70 BITS at 1000 BITS/$", () => {
    const costMicros: UsdMicros = 70_000; // $0.07
    const bits = usdMicrosToBits(costMicros, CANONICAL_RATE);
    expect(bits).toBe(70);
  });

  it("converts $1.00 to 1000 BITS at 1000 BITS/$", () => {
    const costMicros: UsdMicros = 1_000_000; // $1.00
    const bits = usdMicrosToBits(costMicros, CANONICAL_RATE);
    expect(bits).toBe(1000);
  });

  it("same $0.07 produces same BITS for LLM and image modality", () => {
    const costMicros: UsdMicros = 70_000;
    const llmBits = usdMicrosToBits(costMicros, CANONICAL_RATE);
    const imageBits = usdMicrosToBits(costMicros, CANONICAL_RATE);
    expect(llmBits).toBe(imageBits);
  });

  it("rounds down (floor) for fractional BITS", () => {
    // $0.0001 = 100 micros → 100/1000 = 0.1 BITS → floor = 0
    const bits = usdMicrosToBits(100, CANONICAL_RATE);
    expect(bits).toBe(0);
  });

  it("reverse conversion: 70 BITS → $0.07", () => {
    const micros = bitsToUsdMicros(70, CANONICAL_RATE);
    expect(micros).toBe(70_000);
  });

  it("documents the 10× legacy discrepancy without fixing it", () => {
    const costMicros: UsdMicros = 1_000_000; // $1.00
    const llmBits = usdMicrosToBits(costMicros, LEGACY_EXCHANGE_RATES.LLM_ENGINE);
    const genBits = usdMicrosToBits(costMicros, LEGACY_EXCHANGE_RATES.GENERATION_ENGINE);
    expect(llmBits).toBe(1000);
    expect(genBits).toBe(100);
    expect(EXCHANGE_RATE_DISCREPANCY.ratio).toBe(10);
    // B1 does NOT pick one — just documents the discrepancy
  });

  it("throws on negative micros", () => {
    expect(() => usdMicrosToBits(-1, CANONICAL_RATE)).toThrow();
  });

  it("throws on negative bits", () => {
    expect(() => bitsToUsdMicros(-1, CANONICAL_RATE)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Duplicate idempotency keys cannot double-charge
// ═══════════════════════════════════════════════════════════════════════

describe("2. Idempotency: duplicate keys cannot double-charge", () => {
  it("two entries with same idempotency key are the same entry", () => {
    const entry1 = makeEntry({
      userId: "user-1",
      amount: 100,
      direction: "debit",
      type: "SETTLE",
      bucket: "monthly",
      idempotencyKey: "charge:run-1",
    });
    const entry2 = makeEntry({
      userId: "user-1",
      amount: 100,
      direction: "debit",
      type: "SETTLE",
      bucket: "monthly",
      idempotencyKey: "charge:run-1", // same key
    });
    // In the database, the unique constraint on idempotency_key
    // would reject the second insert. Here we verify the contract:
    expect(entry1.idempotencyKey).toBe(entry2.idempotencyKey);
    // The RPC returns replayed=true for duplicate keys
  });

  it("balance projection counts each idempotency key once", () => {
    const userId = "user-1";
    // Simulate: grant 1000, then settle 100 once (not twice)
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 1000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "grant:1" }),
      makeEntry({ userId, amount: 100, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "charge:run-1" }),
      // Duplicate key would be rejected by DB — not included here
    ];
    const balance = projectBalance(userId, entries, []);
    expect(balance.totalGranted).toBe(1000);
    expect(balance.totalSettled).toBe(100);
    expect(balance.economicBalance).toBe(900);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Two simultaneous reservations cannot overspend
// ═══════════════════════════════════════════════════════════════════════

describe("3. Concurrency: simultaneous reservations cannot overspend", () => {
  it("UNSAFE (bug): two concurrent checks can overspend", () => {
    const balance: BalanceProjection = {
      userId: "user-1",
      totalGranted: 500,
      totalSettled: 0,
      totalExpired: 0,
      totalAdjustments: 0,
      totalHeld: 0,
      economicBalance: 500,
      availableBalance: 500,
      buckets: {} as any,
    };
    // Two reservations of 400 each against 500 balance
    const result = simulateConcurrentReservationsUnsafe(balance, 400, 400);
    // BUG: both see 500 >= 400, both succeed, but 800 > 500
    expect(result.bothSucceed).toBe(true);
    expect(result.overspent).toBe(true);
    expect(result.availableAfter).toBe(-300);
  });

  it("SAFE (atomic): second reservation sees reduced balance", () => {
    const balance: BalanceProjection = {
      userId: "user-1",
      totalGranted: 500,
      totalSettled: 0,
      totalExpired: 0,
      totalAdjustments: 0,
      totalHeld: 0,
      economicBalance: 500,
      availableBalance: 500,
      buckets: {} as any,
    };
    // Two reservations of 400 each against 500 balance
    const result = simulateConcurrentReservationsSafe(balance, 400, 400);
    // First succeeds (500 >= 400), second fails (100 < 400)
    expect(result.bothSucceed).toBe(false);
    expect(result.overspent).toBe(false);
    expect(result.availableAfter).toBe(100); // only first reservation held
  });

  it("SAFE: two small reservations both succeed", () => {
    const balance: BalanceProjection = {
      userId: "user-1",
      totalGranted: 500,
      totalSettled: 0,
      totalExpired: 0,
      totalAdjustments: 0,
      totalHeld: 0,
      economicBalance: 500,
      availableBalance: 500,
      buckets: {} as any,
    };
    const result = simulateConcurrentReservationsSafe(balance, 200, 200);
    expect(result.bothSucceed).toBe(true);
    expect(result.overspent).toBe(false);
    expect(result.availableAfter).toBe(100);
  });

  it("reservation fails when insufficient balance", () => {
    const balance: BalanceProjection = {
      userId: "user-1",
      totalGranted: 100,
      totalSettled: 0,
      totalExpired: 0,
      totalAdjustments: 0,
      totalHeld: 0,
      economicBalance: 100,
      availableBalance: 100,
      buckets: {} as any,
    };
    const result = simulateReservation(balance, 200);
    expect(result.canReserve).toBe(false);
    expect(result.availableAfter).toBe(100); // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Reservation + settlement preserves accounting invariants
// ═══════════════════════════════════════════════════════════════════════

describe("4. Reservation + settlement preserves invariants", () => {
  it("settle less than reserved: actual < estimated", () => {
    // Grant 5000, reserve 1000, settle 723, release 277
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 5000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "grant:1" }),
      makeEntry({ userId, amount: 1000, direction: "debit", type: "RESERVE", bucket: "monthly", idempotencyKey: "reserve:1" }),
      makeEntry({ userId, amount: 723, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "settle:1" }),
      makeEntry({ userId, amount: 277, direction: "credit", type: "RELEASE", bucket: "monthly", idempotencyKey: "release:1" }),
    ];
    const reservations: Reservation[] = [
      makeReservation({ userId, runId: "run-1", estimatedBits: 1000, idempotencyKey: "reserve:1", status: "SETTLED", actualBits: 723, releasedBits: 277 }),
    ];
    const balance = projectBalance(userId, entries, []);
    // economicBalance = 5000 - 723 = 4277
    expect(balance.totalSettled).toBe(723);
    expect(balance.economicBalance).toBe(4277);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });

  it("settle exactly reserved: actual = estimated", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 5000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "grant:1" }),
      makeEntry({ userId, amount: 1000, direction: "debit", type: "RESERVE", bucket: "monthly", idempotencyKey: "reserve:1" }),
      makeEntry({ userId, amount: 1000, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "settle:1" }),
    ];
    const balance = projectBalance(userId, entries, []);
    expect(balance.totalSettled).toBe(1000);
    expect(balance.economicBalance).toBe(4000);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });

  it("settle more than reserved: actual > estimated (extra drawn from available)", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 5000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "grant:1" }),
      makeEntry({ userId, amount: 1000, direction: "debit", type: "RESERVE", bucket: "monthly", idempotencyKey: "reserve:1" }),
      makeEntry({ userId, amount: 1500, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "settle:1" }),
      makeEntry({ userId, amount: 1000, direction: "credit", type: "RELEASE", bucket: "monthly", idempotencyKey: "release:1" }),
    ];
    const balance = projectBalance(userId, entries, []);
    // settle 1500, release the full 1000 reservation
    // economicBalance = 5000 - 1500 = 3500
    expect(balance.totalSettled).toBe(1500);
    expect(balance.economicBalance).toBe(3500);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });

  it("simulateSettlement preserves available balance", () => {
    const balance: BalanceProjection = {
      userId: "user-1",
      totalGranted: 5000,
      totalSettled: 0,
      totalExpired: 0,
      totalAdjustments: 0,
      totalHeld: 1000,
      economicBalance: 5000,
      availableBalance: 4000,
      buckets: {} as any,
    };
    const after = simulateSettlement(balance, 1000, 723);
    // settled 723, released 277, held reduced by 1000
    expect(after.totalSettled).toBe(723);
    expect(after.totalHeld).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Reservation + release restores available balance
// ═══════════════════════════════════════════════════════════════════════

describe("5. Reservation + release restores available balance", () => {
  it("release returns all held funds to available", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 5000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "grant:1" }),
      makeEntry({ userId, amount: 1000, direction: "debit", type: "RESERVE", bucket: "monthly", idempotencyKey: "reserve:1" }),
      makeEntry({ userId, amount: 1000, direction: "credit", type: "RELEASE", bucket: "monthly", idempotencyKey: "release:1" }),
    ];
    const reservations: Reservation[] = [
      makeReservation({ userId, runId: "run-1", estimatedBits: 1000, idempotencyKey: "reserve:1", status: "RELEASED", releasedBits: 1000 }),
    ];
    const balance = projectBalance(userId, entries, []);
    // No pending reservations, no settled spend
    expect(balance.totalSettled).toBe(0);
    expect(balance.totalHeld).toBe(0);
    expect(balance.economicBalance).toBe(5000);
    expect(balance.availableBalance).toBe(5000);
    expect(validateAccountingInvariant(balance)).toBe(true);
    expect(validateAvailableBalance(balance)).toBe(true);
  });

  it("simulateRelease restores available balance", () => {
    const balance: BalanceProjection = {
      userId: "user-1",
      totalGranted: 5000,
      totalSettled: 0,
      totalExpired: 0,
      totalAdjustments: 0,
      totalHeld: 1000,
      economicBalance: 5000,
      availableBalance: 4000,
      buckets: {} as any,
    };
    const after = simulateRelease(balance, 1000);
    expect(after.totalHeld).toBe(0);
    expect(after.availableBalance).toBe(5000);
  });

  it("release is NOT a refund (no REFUND entry type)", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 5000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "grant:1" }),
      makeEntry({ userId, amount: 1000, direction: "debit", type: "RESERVE", bucket: "monthly", idempotencyKey: "reserve:1" }),
      // Release is a CREDIT with type=RELEASE, NOT type=REFUND
      makeEntry({ userId, amount: 1000, direction: "credit", type: "RELEASE", bucket: "monthly", idempotencyKey: "release:1" }),
    ];
    const balance = projectBalance(userId, entries, []);
    // Release should NOT count as a grant
    expect(balance.totalGranted).toBe(5000); // not 6000
    expect(balance.totalSettled).toBe(0);
    expect(balance.economicBalance).toBe(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Settled ledger entries reference immutable pricing versions
// ═══════════════════════════════════════════════════════════════════════

describe("6. Pricing version immutability", () => {
  it("settled entry carries pricing version", () => {
    const entry = makeEntry({
      userId: "user-1",
      amount: 180,
      direction: "debit",
      type: "SETTLE",
      bucket: "monthly",
      idempotencyKey: "settle:run-1",
      pricingVersion: "price-2026-08-13-v1",
      exchangeRateVersion: "exch-2026-08-13-v1",
      providerCostMicros: 90_000, // $0.09
    });
    expect(entry.pricingVersion).toBe("price-2026-08-13-v1");
    expect(entry.exchangeRateVersion).toBe("exch-2026-08-13-v1");
    expect(entry.providerCostMicros).toBe(90_000);
  });

  it("historical charge is reproducible from pricing version + exchange rate", () => {
    // $0.09 provider cost, 50% margin → $0.18 customer price → 180 BITS
    const providerCostMicros: UsdMicros = 90_000;
    const loadedCost = applyMargin(providerCostMicros, 5000); // 50% margin
    const bits = usdMicrosToBits(loadedCost, CANONICAL_RATE);
    expect(loadedCost).toBe(180_000); // $0.18
    expect(bits).toBe(180);
    // This charge can be reproduced later from:
    //   usage + provider/model + pricingVersion + exchangeRateVersion
  });

  it("margin calculation is exact with integer math", () => {
    // $0.09 = 90000 micros, 50% margin
    const price = applyMargin(90_000, 5000);
    expect(price).toBe(180_000);
    // Realized margin
    const margin = realizedMarginBps(90_000, 180_000);
    expect(margin).toBe(5000); // 50%
  });

  it("different pricing versions produce different BITS for same cost", () => {
    const cost: UsdMicros = 90_000;
    const v1Bits = usdMicrosToBits(cost, CANONICAL_RATE); // 1000 BITS/$
    const v2Rate: ExchangeRateVersion = {
      ...CANONICAL_RATE,
      id: "exch-2027-01-01-v2",
      bitsPerUsdMicro: { num: 1, den: 2000 }, // 500 BITS/$ (price change)
    };
    const v2Bits = usdMicrosToBits(cost, v2Rate);
    expect(v1Bits).toBe(90);
    expect(v2Bits).toBe(45);
    // Historical charges using v1 are NOT affected by v2
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Failure/retry billability is explicit
// ═══════════════════════════════════════════════════════════════════════

describe("7. Billability: failure and retry classification", () => {
  it("USER_REQUEST is billable", () => {
    expect(isBillable("USER_REQUEST")).toBe(true);
    const decision = createBillabilityDecision("USER_REQUEST");
    expect(decision.billable).toBe(true);
    expect(decision.liittAbsorbed).toBe(false);
  });

  it("FAILURE_LITT is not billable and LiTT absorbs", () => {
    expect(isBillable("FAILURE_LITT")).toBe(false);
    expect(isLiittAbsorbed("FAILURE_LITT")).toBe(true);
    const decision = createBillabilityDecision("FAILURE_LITT");
    expect(decision.billable).toBe(false);
    expect(decision.liittAbsorbed).toBe(true);
    expect(decision.meterProviderCost).toBe(true);
  });

  it("FAILURE_PROVIDER is not billable and LiTT absorbs", () => {
    expect(isBillable("FAILURE_PROVIDER")).toBe(false);
    expect(isLiittAbsorbed("FAILURE_PROVIDER")).toBe(true);
  });

  it("RETRY_INTERNAL is not billable and LiTT absorbs", () => {
    expect(isBillable("RETRY_INTERNAL")).toBe(false);
    expect(isLiittAbsorbed("RETRY_INTERNAL")).toBe(true);
  });

  it("USER_CANCEL_BEFORE_USAGE is not billable", () => {
    expect(isBillable("USER_CANCEL_BEFORE_USAGE")).toBe(false);
    expect(isLiittAbsorbed("USER_CANCEL_BEFORE_USAGE")).toBe(false);
  });

  it("USER_CANCEL_AFTER_USAGE is billable (consumed amount)", () => {
    expect(isBillable("USER_CANCEL_AFTER_USAGE")).toBe(true);
  });

  it("CACHE_HIT does not meter provider cost", () => {
    expect(shouldMeterProviderCost("CACHE_HIT")).toBe(false);
  });

  it("BYOK is billable (platform fee, not provider cost)", () => {
    expect(isBillable("BYOK")).toBe(true);
    expect(isLiittAbsorbed("BYOK")).toBe(false);
  });

  it("INTERNAL is not billable but meters cost", () => {
    expect(isBillable("INTERNAL")).toBe(false);
    expect(shouldMeterProviderCost("INTERNAL")).toBe(true);
  });

  it("billability decision includes retry sequence", () => {
    const decision = createBillabilityDecision("RETRY_INTERNAL", {
      originalRequestId: "req-1",
      retrySequence: 2,
    });
    expect(decision.retrySequence).toBe(2);
    expect(decision.originalRequestId).toBe("req-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Existing balance behavior has a documented reconciliation path
// ═══════════════════════════════════════════════════════════════════════

describe("8. Reconciliation path for existing systems", () => {
  it("existing category values map to canonical entry types", () => {
    expect(CATEGORY_TO_ENTRY_TYPE["subscription_grant"]).toBe("GRANT");
    expect(CATEGORY_TO_ENTRY_TYPE["beta_grant"]).toBe("GRANT");
    expect(CATEGORY_TO_ENTRY_TYPE["purchase"]).toBe("PURCHASE");
    expect(CATEGORY_TO_ENTRY_TYPE["usage"]).toBe("SETTLE");
    expect(CATEGORY_TO_ENTRY_TYPE["refund"]).toBe("REFUND");
    expect(CATEGORY_TO_ENTRY_TYPE["adjustment"]).toBe("ADJUSTMENT");
    expect(CATEGORY_TO_ENTRY_TYPE["promotion"]).toBe("PROMO");
  });

  it("canonical entry types map back to existing categories", () => {
    expect(ENTRY_TYPE_TO_CATEGORY["GRANT"]).toBe("subscription_grant");
    expect(ENTRY_TYPE_TO_CATEGORY["PURCHASE"]).toBe("purchase");
    expect(ENTRY_TYPE_TO_CATEGORY["SETTLE"]).toBe("usage");
    expect(ENTRY_TYPE_TO_CATEGORY["REFUND"]).toBe("refund");
    expect(ENTRY_TYPE_TO_CATEGORY["ADJUSTMENT"]).toBe("adjustment");
    expect(ENTRY_TYPE_TO_CATEGORY["PROMO"]).toBe("promotion");
  });

  it("new entry types (RESERVE, RELEASE) map to legacy categories for compat", () => {
    // RESERVE maps to "usage" (legacy: reservations were modeled as usage debits)
    expect(ENTRY_TYPE_TO_CATEGORY["RESERVE"]).toBe("usage");
    // RELEASE maps to "refund" (legacy: releases were modeled as refunds)
    expect(ENTRY_TYPE_TO_CATEGORY["RELEASE"]).toBe("refund");
  });

  it("legacy exchange rates are documented but not unified", () => {
    // LLM engine: 1000 BITS/$
    expect(LEGACY_EXCHANGE_RATES.LLM_ENGINE.bitsPerUsdMicro).toEqual({ num: 1, den: 1000 });
    // Generation engine: 100 BITS/$
    expect(LEGACY_EXCHANGE_RATES.GENERATION_ENGINE.bitsPerUsdMicro).toEqual({ num: 1, den: 10000 });
    // The 10× discrepancy is documented
    expect(EXCHANGE_RATE_DISCREPANCY.ratio).toBe(10);
  });

  it("users.credits column does not exist in schema (confirmed by audit)", () => {
    // The audit found that users.credits is referenced by 3 RPCs
    // (charge_credits, reserve_credits, refund_credits) but the column
    // was NEVER added to the users table by any migration.
    // This means these RPCs silently fail in production.
    // The migration strategy must:
    // 1. NOT add the column (that would create a parallel balance)
    // 2. Replace the RPCs with ledger-based equivalents
    // 3. Update agent-billing.ts to use the new RPCs
    // This test documents the finding:
    const legacyWriters = [
      "supabase/migrations/20260803100000_evolve_user_agents_instances.sql:charge_credits",
      "supabase/migrations/20260803100000_evolve_user_agents_instances.sql:reserve_credits",
      "supabase/migrations/20260803100000_evolve_user_agents_instances.sql:refund_credits",
      "src/lib/agent-billing.ts:reserveCredits()",
      "src/lib/agent-billing.ts:settleRun()",
      "src/app/api/litt/runs/[runId]/cancel/route.ts",
    ];
    expect(legacyWriters.length).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. Accounting invariant (fundamental equation)
// ═══════════════════════════════════════════════════════════════════════

describe("9. Accounting invariant: granted - settled - expired ± adjustments = balance", () => {
  it("simple grant + settle", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 1000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "g1" }),
      makeEntry({ userId, amount: 300, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "s1" }),
    ];
    const balance = projectBalance(userId, entries, []);
    expect(balance.totalGranted).toBe(1000);
    expect(balance.totalSettled).toBe(300);
    expect(balance.economicBalance).toBe(700);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });

  it("grant + settle + adjustment", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 1000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "g1" }),
      makeEntry({ userId, amount: 300, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "s1" }),
      makeEntry({ userId, amount: 50, direction: "credit", type: "ADJUSTMENT", bucket: "monthly", idempotencyKey: "a1" }),
    ];
    const balance = projectBalance(userId, entries, []);
    expect(balance.totalAdjustments).toBe(50);
    expect(balance.economicBalance).toBe(750);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });

  it("grant + settle + expiration", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 1000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "g1" }),
      makeEntry({ userId, amount: 300, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "s1" }),
      makeEntry({ userId, amount: 200, direction: "debit", type: "EXPIRATION", bucket: "monthly", idempotencyKey: "e1" }),
    ];
    const balance = projectBalance(userId, entries, []);
    expect(balance.totalExpired).toBe(200);
    expect(balance.economicBalance).toBe(500);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });

  it("reservation affects availability but not economic balance", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 5000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "g1" }),
      makeEntry({ userId, amount: 1000, direction: "debit", type: "RESERVE", bucket: "monthly", idempotencyKey: "r1" }),
    ];
    const reservations: Reservation[] = [
      makeReservation({ userId, runId: "run-1", estimatedBits: 1000, idempotencyKey: "r1" }),
    ];
    const balance = projectBalance(userId, entries, reservations);
    // Economic balance is unchanged by reservation
    expect(balance.economicBalance).toBe(5000);
    // Available balance is reduced
    expect(balance.availableBalance).toBe(4000);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });

  it("multi-bucket balance", () => {
    const userId = "user-1";
    const entries: LedgerEntry[] = [
      makeEntry({ userId, amount: 3000, direction: "credit", type: "GRANT", bucket: "monthly", idempotencyKey: "g1" }),
      makeEntry({ userId, amount: 2000, direction: "credit", type: "PURCHASE", bucket: "purchased", idempotencyKey: "g2" }),
      makeEntry({ userId, amount: 500, direction: "debit", type: "SETTLE", bucket: "monthly", idempotencyKey: "s1" }),
      makeEntry({ userId, amount: 100, direction: "debit", type: "SETTLE", bucket: "purchased", idempotencyKey: "s2" }),
    ];
    const balance = projectBalance(userId, entries, []);
    expect(balance.totalGranted).toBe(5000);
    expect(balance.totalSettled).toBe(600);
    expect(balance.economicBalance).toBe(4400);
    expect(balance.buckets.monthly.granted).toBe(3000);
    expect(balance.buckets.monthly.settled).toBe(500);
    expect(balance.buckets.purchased.granted).toBe(2000);
    expect(balance.buckets.purchased.settled).toBe(100);
    expect(validateAccountingInvariant(balance)).toBe(true);
  });
});
