# B1 — Canonical Billing Foundation Report

**Date:** 2026-08-14
**Phase:** B1 (contracts, schema design, invariant tests — no runtime changes)
**Branch:** `feat/litt-os-kernel-phase1`
**Status:** COMPLETE — awaiting review before B2

---

## What B1 Delivered

### 1. Canonical Monetary Unit System
**File:** `src/lib/billing/contracts/monetary.ts`

- ONE conversion: USD micros ↔ BITS (integer math, no floating-point)
- `usdMicrosToBits()` and `bitsToUsdMicros()` with floor rounding
- `applyMargin()` and `realizedMarginBps()` for margin calculation
- `ExchangeRateVersion` contract — immutable, versioned
- `LEGACY_EXCHANGE_RATES` — documents the two existing rates WITHOUT unifying them
- `EXCHANGE_RATE_DISCREPANCY` — documents the 10× gap

**Critical decision:** B1 does NOT pick between 100 BITS/$ and 1000 BITS/$. Both are classified as legacy. The canonical rate will be chosen during reconciliation (B1.10 / B2).

### 2. Canonical Ledger Entry Types & Reservation Lifecycle
**File:** `src/lib/billing/contracts/ledger.ts`

- 9 entry types: `GRANT`, `PURCHASE`, `PROMO`, `RESERVE`, `SETTLE`, `RELEASE`, `REFUND`, `ADJUSTMENT`, `EXPIRATION`
- 6 credit buckets: `monthly`, `purchased`, `beta_promotional`, `compensation`, `enterprise_commit`, `admin`
- `LedgerEntry` contract with full correlation chain (runId, usageEventId, reservationId, grantId, pricingVersion, exchangeRateVersion, providerCostMicros)
- `Reservation` contract with lifecycle: PENDING → SETTLED / RELEASED / EXPIRED / FAILED
- `BalanceProjection` with per-bucket breakdown
- `validateAccountingInvariant()` — proves: granted - settled - expired ± adjustments = economic balance
- Category ↔ entry-type mapping for backward compatibility

**File:** `src/lib/billing/contracts/reservation-calculator.ts`

- Pure functions for testing accounting invariants without a database
- `projectBalance()` — canonical balance calculation from ledger entries
- `simulateReservation()`, `simulateSettlement()`, `simulateRelease()`
- `simulateConcurrentReservationsUnsafe()` — demonstrates the overspend bug
- `simulateConcurrentReservationsSafe()` — demonstrates the atomic-lock fix

### 3. Billability Classification
**File:** `src/lib/billing/contracts/billability.ts`

- 12 billability causes: `USER_REQUEST`, `USER_CANCEL_BEFORE_USAGE`, `USER_CANCEL_AFTER_USAGE`, `RETRY_INTERNAL`, `PROVIDER_RETRY`, `SYSTEM_RETRY`, `SPECULATIVE`, `CACHE_HIT`, `FAILURE_LITT`, `FAILURE_PROVIDER`, `PROMOTION`, `INTERNAL`, `BYOK`
- `isBillable()`, `isLiittAbsorbed()`, `shouldMeterProviderCost()`
- `createBillabilityDecision()` — produces typed decision with retry sequence

### 4. Pricing Versioning
**File:** `src/lib/billing/contracts/pricing.ts`

- `PricingVersion` — immutable, versioned, with margin/infra/risk/payment defaults
- `PricingCatalogEntry` — versioned provider/customer rates per model/capability
- `RatingResult` — stored result of rating a usage event
- `LEGACY_CATALOGS` — documents all 5 existing hardcoded catalogs

### 5. Spend Controls / Budgets
**File:** `src/lib/billing/contracts/spend-controls.ts`

- 9 budget scopes: `per_request`, `daily`, `monthly`, `per_agent`, `organization`, `project`, `api_key`, `per_model`, `automation`
- 3 enforcement modes: `hard_stop`, `soft_warning`, `auto_topup`
- `SpendControl`, `BudgetCheckResult`, `SpendSnapshot`, `LowBalanceAlert`
- Documents existing unused budget columns and UI-only budgets

### 6. Unified UsageEvent Contract
**File:** `src/lib/billing/contracts/usage-event.ts`

- `UsageEvent` — immutable raw usage with all fields from master directive
- `CostEvent` — what LiTT paid (micro-USD)
- `RatingEvent` — what the customer was charged
- `BillingCorrelation` — full correlation chain
- `EXISTING_TABLE_MAPPING` — how existing tables map to the unified contract

### 7. Proposed Schema Extensions (NOT APPLIED)
**File:** `supabase/migrations/20260813200000_b1_canonical_billing_contracts.sql`

All additive. No existing tables modified. No data migrated. No RPCs changed.

New tables:
- `credit_reservations` — reservation lifecycle
- `credit_grants` — per-grant tracking with priority and expiration
- `usage_events` — unified immutable usage ledger
- `cost_events` — provider cost in micro-USD
- `rating_events` — customer pricing with version correlation
- `pricing_catalog` — versioned pricing entries
- `pricing_versions` — immutable pricing version registry
- `exchange_rate_versions` — immutable exchange rate registry
- `spend_controls` — server-enforced budget limits

Extended columns on `credit_ledger`:
- `run_id`, `usage_event_id`, `reservation_id`, `grant_id`
- `pricing_version`, `exchange_rate_version`, `provider_cost_micros`
- `entry_type` (canonical type alongside existing `category`)

### 8. B1 Invariant Tests
**File:** `tests/billing/b1-canonical-contracts.test.ts`

**45 tests, all passing.** Proves:

1. ✅ Same micro-USD → same BITS regardless of modality
2. ✅ Duplicate idempotency keys cannot double-charge
3. ✅ Two simultaneous reservations cannot overspend (with atomic locking)
4. ✅ Reservation + settlement preserves accounting invariants
5. ✅ Reservation + release restores available balance
6. ✅ Settled ledger entries reference immutable pricing versions
7. ✅ Failure/retry billability is explicit
8. ✅ Existing balance behavior has a documented reconciliation path
9. ✅ Accounting invariant: granted - settled - expired ± adjustments = balance

---

## `users.credits` Migration Strategy

### Critical Finding

**The `users.credits` column DOES NOT EXIST in the database schema.**

No migration ever adds it. However, three RPCs reference it:
- `charge_credits` — silently swallows errors (`EXCEPTION WHEN OTHERS THEN NULL`)
- `reserve_credits` — raises exception on failure
- `refund_credits` — silently no-ops if `agent_runs` row not found

**This means agent billing via `agent-billing.ts` is silently failing in production.** The `charge_credits` RPC catches the "column does not exist" error and returns success. Reservations may fail with "insufficient balance: have 0, need N" (since `COALESCE(credits, 0)` returns 0).

### Reader/Writer Classification

| # | Location | Type | Classification |
|---|----------|------|----------------|
| 1 | `20260803100000...sql` `charge_credits` | SQL RPC | LEGACY_WRITER (broken) |
| 2 | `20260803100000...sql` `reserve_credits` | SQL RPC | LEGACY_WRITER (broken) |
| 3 | `20260803100000...sql` `refund_credits` | SQL RPC | LEGACY_WRITER (broken) |
| 4 | `src/lib/agent-billing.ts:116` `reserveCredits()` | TS caller | LEGACY_WRITER |
| 5 | `src/lib/agent-billing.ts:193` `reserveCredits()` error path | TS caller | LEGACY_WRITER |
| 6 | `src/lib/agent-billing.ts:237` `settleRun()` | TS caller | LEGACY_WRITER |
| 7 | `src/app/api/litt/runs/[runId]/cancel/route.ts:81` | TS caller | LEGACY_WRITER |
| 8-10 | `agent-billing.ts`, `cancel/route.ts`, `usage/route.ts` | TS readers | DISPLAY_ONLY (reads `agent_runs.credits_charged`, not `users.credits`) |
| 11-13 | `tests/agent-billing.test.ts`, `agent-instance-isolation.test.ts` | Tests | MIGRATION_DEPENDENCY |

### Migration Plan (DO NOT EXECUTE YET)

**Phase 1: Schema (B2)**
- Apply `20260813200000_b1_canonical_billing_contracts.sql` (additive only)
- Do NOT add `users.credits` column
- Do NOT remove legacy RPCs

**Phase 2: New RPCs (B2)**
- Create `reserve_bits()` RPC — uses `credit_ledger` with RESERVE entry
- Create `settle_bits()` RPC — uses `credit_ledger` with SETTLE + RELEASE entries
- Create `release_bits()` RPC — uses `credit_ledger` with RELEASE entry
- All use advisory locks + idempotency keys

**Phase 3: Update callers (B2)**
- Update `agent-billing.ts` to call `reserve_bits` / `settle_bits` / `release_bits`
- Update `cancel/route.ts` to call `release_bits`
- Update tests to mock new RPCs

**Phase 4: Deprecate legacy RPCs (B2)**
- Drop `charge_credits`, `reserve_credits`, `refund_credits` RPCs
- These were never working (column doesn't exist), so dropping is safe

**Phase 5: Reconciliation (B2)**
- Verify no production data was lost (the RPCs were failing silently)
- Check `agent_runs.credits_charged` for any runs that were "charged" — these amounts were never actually debited from any balance
- If any customer was incorrectly charged, issue compensation grants

### What NOT to Do

- ❌ Do NOT add `users.credits` column — that would create a parallel balance
- ❌ Do NOT silently pick 100 or 1000 BITS/$ — reconcile first
- ❌ Do NOT delete legacy RPCs before updating callers
- ❌ Do NOT migrate data — there is no data to migrate (column doesn't exist)

---

## Exchange Rate Reconciliation Strategy

### The Problem

| Engine | Rate | Source |
|--------|------|--------|
| LLM Cost Engine | $1 = 1000 BITS | `llm-cost-engine.ts:279` |
| Generation Cost Engine | $1 = 100 BITS | `generation/cost-engine.ts:19` |
| Usage Cost Constants | Flat BITS (no rate) | `usage-costs.ts` |

Same $1 provider cost charges 10× differently depending on which engine processes it.

### Reconciliation Steps (B2, NOT B1)

1. **Audit historical charges** — query `llm_usage_records` and `generation_jobs` to determine which rate each charge used
2. **Determine customer-facing rate** — what rate were customers told their BITS were worth?
3. **Determine provider cost rate** — what rate was used to convert provider costs to BITS?
4. **Classify each historical charge** — tag with the exchange rate version it used
5. **Create canonical exchange rate version** — pick one rate (likely 1000 BITS/$ to match LLM engine, since LLM is the primary usage)
6. **Backfill `pricing_version` and `exchange_rate_version` on historical charges**
7. **Do NOT rewrite historical BITS amounts** — they are immutable
8. **Future charges use the canonical rate**

### Why Not Fix It Now

The user explicitly said:

> "Do not immediately 'fix' 100 vs 1000 BITS/$. First determine what existing customer balances, pricing displays, Stripe purchases, generation prices, and LLM charges were historically based on."

B1 defines the contract. B2 performs the reconciliation.

---

## Files Created

### Contracts (new)
- `src/lib/billing/contracts/monetary.ts` — canonical monetary units
- `src/lib/billing/contracts/ledger.ts` — ledger entry types & reservation lifecycle
- `src/lib/billing/contracts/billability.ts` — billability classification
- `src/lib/billing/contracts/pricing.ts` — pricing versioning
- `src/lib/billing/contracts/spend-controls.ts` — spend controls / budgets
- `src/lib/billing/contracts/usage-event.ts` — unified UsageEvent
- `src/lib/billing/contracts/reservation-calculator.ts` — pure functions for invariant testing
- `src/lib/billing/contracts/index.ts` — barrel export

### Schema (proposed, NOT applied)
- `supabase/migrations/20260813200000_b1_canonical_billing_contracts.sql`

### Tests
- `tests/billing/b1-canonical-contracts.test.ts` — 45 invariant tests

### Documentation
- `docs/litt-billing/b1-canonical-foundation.md` (this file)

---

## Test Results

```
B1 invariant tests: 45 passed, 0 failed
Full suite: 2926 passed, 53 skipped, 1 flaky (vapi-tools.test.ts hook timeout — pre-existing, unrelated)
```

---

## What B1 Did NOT Do

- ❌ Did NOT apply any migrations
- ❌ Did NOT change runtime billing behavior
- ❌ Did NOT pick between 100 and 1000 BITS/$
- ❌ Did NOT add `users.credits` column
- ❌ Did NOT remove legacy RPCs
- ❌ Did NOT update `agent-billing.ts` callers
- ❌ Did NOT build public API billing
- ❌ Did NOT build Stripe checkout changes
- ❌ Did NOT build UI changes
- ❌ Did NOT push or merge

---

## Recommended B2 Scope

Based on B1, B2 should:

1. **Apply the schema migration** (`20260813200000`)
2. **Implement canonical reservation RPCs** (`reserve_bits`, `settle_bits`, `release_bits`)
3. **Update `agent-billing.ts`** to use new RPCs
4. **Drop broken legacy RPCs** (`charge_credits`, `reserve_credits`, `refund_credits`)
5. **Perform exchange rate reconciliation** — audit historical charges, pick canonical rate
6. **Create first `pricing_version` and `exchange_rate_version` records**
7. **Begin migrating hardcoded cost catalogs** to `pricing_catalog` table

B2 should NOT:
- Build public API billing (B11)
- Change Stripe checkout (B8)
- Change UI (B9)
- Build margin analytics (B10)

---

## STOP

B1 is complete. Contracts defined. Schema designed. Invariants proven. Migration strategy documented.

**Awaiting review before B2.**
