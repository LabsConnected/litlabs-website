# B2.7 — Dual-System Reconciliation Report

**Date:** 2026-08-14
**Status:** COMPLETE

---

## Purpose

Document the coexistence of the old (broken) and new (canonical) billing paths, and verify that no production behavior changed until the B2 migration is applied.

---

## Old Billing Path (BROKEN — never worked in production)

### What it called
```
agent-billing.ts
  → reserve_credits(p_user_id, p_credits)     ← DOES NOT EXIST
  → refund_credits(p_run_id, p_credits)       ← DOES NOT EXIST
```

### Why it failed
- `reserve_credits` RPC was never deployed to production
- `refund_credits` RPC was never deployed to production
- Every call returned "function not found" error
- `agent-billing.ts` has fail-closed behavior: aborts the run

### What it referenced
- `agent_runs.credits_charged` — column does NOT exist in production
- `agent_runs.input_tokens` — column does NOT exist in production
- `agent_runs.output_tokens` — column does NOT exist in production
- `agent_runs.agent_instance_id` — column does NOT exist in production
- `agent_runs.conversation_id` — column does NOT exist in production
- `agent_runs.started_at` — column does NOT exist in production
- `agent_runs.completed_at` — column does NOT exist in production

### Net effect
**Zero credits were ever charged, reserved, or refunded through this path.** The `credit_ledger` entries that exist (10 entries, 3 users) were all created through the working `grant_credits` and `debit_credits` RPCs, not through `agent-billing.ts`.

---

## New Billing Path (CANONICAL — B2)

### What it calls
```
agent-billing.ts (B2)
  → reserve_bits(p_user_id, p_amount, p_idempotency_key, ...)
  → settle_bits(p_reservation_id, p_actual_amount, p_idempotency_key, ...)
  → release_bits(p_reservation_id, p_idempotency_key)
```

### What it writes to
- `credit_reservations` (new table — not yet applied to production)
- `credit_ledger` (existing table — via settle_bits only)
- `agent_runs` (existing table — using production columns: `agent_name`, `task`, `status`, `agent_mode`, `input` jsonb, `output` jsonb)
- `billing_reconciliations` (existing table — on failure)

### Idempotency
- `reserve_bits`: keyed on `(user_id, idempotency_key)` unique index
- `settle_bits`: keyed on reservation status check (already_settled returns success)
- `release_bits`: keyed on reservation status check (already_released returns success)

### Concurrency safety
- All three RPCs use `pg_advisory_xact_lock(hashtextextended(user_id::TEXT, 0))`
- No two transactions for the same user can run simultaneously
- Available balance can never go negative (checked before reservation)

---

## Production Schema Gap (agent_runs)

### Columns the old code expected vs what production has

| Column | Old code expects | Production has | B2 code uses |
|--------|-----------------|----------------|--------------|
| `id` | ✓ | ✓ | ✓ |
| `user_id` | ✓ (as text) | ✓ (as uuid) | ✓ (as uuid from users table) |
| `agent_name` | ✗ | ✓ | ✓ (stores agentInstanceId) |
| `task` | ✗ | ✓ | ✓ (stores idempotencyKey) |
| `status` | ✓ | ✓ | ✓ |
| `agent_mode` | ✗ | ✓ | ✓ (stores model name) |
| `input` | ✗ | ✓ (jsonb) | ✓ (stores metadata: agent_id, conversation_id, reservation_id, etc.) |
| `output` | ✗ | ✓ (jsonb) | ✓ (stores: input_tokens, output_tokens, credits_charged, etc.) |
| `cost_cents` | ✗ | ✓ | Not used (BITS-denominated) |
| `duration_ms` | ✗ | ✓ | Not used |
| `credits_charged` | ✓ | ✗ | Stored in `output` jsonb |
| `input_tokens` | ✓ | ✗ | Stored in `output` jsonb |
| `output_tokens` | ✓ | ✗ | Stored in `output` jsonb |
| `agent_instance_id` | ✓ | ✗ | Stored in `input` jsonb |
| `conversation_id` | ✓ | ✗ | Stored in `input` jsonb |
| `started_at` | ✓ | ✗ | Uses `created_at` (auto) |
| `completed_at` | ✓ | ✗ | Uses `updated_at` (set on settle) |

### B2 approach
The B2 migration does NOT add columns to `agent_runs`. Instead, it uses the existing `input` and `output` jsonb columns to store billing metadata. This avoids a destructive migration on a production table.

---

## What Has NOT Changed

1. **No migration applied** — `20260814200000_b2_reservation_settlement.sql` is written but NOT pushed
2. **No production RPCs deployed** — `reserve_bits`, `settle_bits`, `release_bits` do not exist in production yet
3. **No production behavior changed** — `agent-billing.ts` is rewritten but the new code calls RPCs that don't exist yet, so it will fail-closed (same effective behavior as before)
4. **`credit_ledger` not modified** — no new columns, no new indexes
5. **`users.credits` not touched** — vestigial column left in place
6. **`wallets` not touched** — legacy table left in place
7. **Stripe checkout not touched**
8. **Pricing UI not touched**
9. **Creator payouts not touched**
10. **Exchange rates not changed** — 100 vs 1000 discrepancy documented but not resolved

---

## Reconciliation: ledger-derived vs cached balance

### The killer invariant
```
economic balance = ledger-derived balance
```

### Current state
- `users.credits` = 50 for all 7 users (default, never mutated)
- `get_user_balances()` = computed from `credit_ledger` (real data)
- These two numbers **do not match** for the 3 users with ledger entries

### B2 approach
- `get_available_balance()` (new) = `get_user_balances().total - sum(active reservations)`
- `users.credits` is **ignored** by both old and new billing paths
- The canonical balance is always ledger-derived
- `users.credits` should be dropped in a future cleanup migration (not B2)

### Proof: existing RPCs never touch users.credits

Queried production for `pg_get_functiondef()` of all three deployed RPCs and searched
the full function bodies for any reference to `users` (table or column).

Result: **zero matches**. `grant_credits`, `debit_credits`, and `get_user_balances`
operate exclusively on `credit_ledger`. They never read, write, or reference
`users.credits` or the `users` table in any way.

This is proven, not inferred.

---

## Deployment Plan (NOT executed — for review)

1. Apply migration: `supabase db push` (creates `credit_reservations` table + 4 RPCs)
2. Deploy updated `agent-billing.ts` (already in code, will start working once RPCs exist)
3. Monitor `billing_reconciliations` table for any settlement failures
4. Run `expire_stale_reservations()` periodically (cron or health check)
5. Verify: `get_available_balance()` matches expected values for test users

### Rollback plan
- The migration is purely additive (new table, new RPCs)
- Rollback = revert `agent-billing.ts` to previous version
- The new table and RPCs can remain (harmless if unused)
