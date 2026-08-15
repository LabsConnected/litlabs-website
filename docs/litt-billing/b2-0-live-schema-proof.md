# B2.0 — Live Production Schema Proof

**Date:** 2026-08-14
**Method:** Read-only queries against production Supabase (`rokbfvuoqildggnhappy`)
**Status:** COMPLETE

---

## Critical Correction from B1

B1 stated: "`users.credits` DOES NOT EXIST in the database."

**This was wrong.** The column exists in production. The user was correct to require live schema proof before proceeding.

---

## Live Production Schema Findings

### `users.credits` — EXISTS

```sql
column_name  | data_type | is_nullable | column_default
-------------|-----------|-------------|---------------
credits      | integer   | YES         | 50
```

- All 7 users have exactly 50 credits (the default value)
- **Has NEVER been mutated** — no charges, no grants, no adjustments
- It is a vestigial column from the initial schema, not an active balance

### `credit_ledger` — EXISTS and has real data

```sql
column_name     | data_type
----------------|----------
id              | uuid
user_id         | uuid
amount          | integer
direction       | text          -- 'credit' | 'debit'
category        | text          -- 'subscription_grant', 'beta_grant', 'purchase', 'usage', 'refund', 'adjustment', 'promotion'
balance_bucket  | text          -- 'monthly', 'purchased', 'beta_promotional'
reference_type  | text
reference_id    | text
description     | text
expires_at      | timestamptz
created_at      | timestamptz
idempotency_key | text
```

**Data summary:**
- 10 entries across 3 users
- 2 promotional grants (beta_promotional): 80 BITS total
- 5 subscription grants (monthly): 2,500 BITS total
- 3 usage debits (monthly): 46 BITS total

### Deployed RPCs (canonical path — WORKING)

#### `grant_credits(p_user_id, p_amount, p_category, p_balance_bucket, p_description, p_idempotency_key, ...)`
- Uses `pg_advisory_xact_lock` for per-user serialization
- Idempotency via exact key match
- Writes to `credit_ledger` with direction='credit'
- Returns `(granted boolean, total_after integer)`

#### `debit_credits(p_user_id, p_amount, p_category, p_description, p_idempotency_key)`
- Uses `pg_advisory_xact_lock` for per-user serialization
- Idempotency via key prefix match (`key:%`)
- Consumes buckets in order: monthly → beta_promotional → purchased
- Writes one debit row per bucket consumed
- Returns `(success boolean, remaining integer)`
- Fails closed if insufficient balance

#### `get_user_balances(p_user_id)`
- Reads from `credit_ledger`
- Computes per-bucket balances: monthly, purchased, beta_promotional, total
- Filters out expired entries (`expires_at IS NULL OR expires_at > now()`)
- Clamps each bucket to GREATEST(bucket, 0)

### NOT Deployed (exist in migration files only)

#### RPCs NOT in production:
- `charge_credits` — NOT deployed
- `reserve_credits` — NOT deployed
- `refund_credits` — NOT deployed

#### Tables NOT in production:
- `llm_usage_records` — NOT deployed
- `generation_jobs` — NOT deployed

### Legacy Tables — EXIST but mostly empty

| Table | Rows | Notes |
|-------|------|-------|
| `wallets` | 6 | All balance=500, sub-balances all 0 |
| `transactions` | 0 | Empty |
| `agent_runs` | 0 | Does NOT have `credits_charged`/`credits_reserved`/`credits_refunded` columns |
| `stripe_events` | 0 | Empty |

### `agent_runs` schema (production)

```sql
column_name  | data_type
-------------|----------
id           | uuid
user_id      | text
agent_name   | text
task         | text
status       | text
logs         | text
created_at   | timestamptz
updated_at   | timestamptz
owner_id     | text
project_id   | uuid
mode         | text
input        | jsonb
output       | jsonb
cost_cents   | integer
duration_ms  | integer
agent_mode   | text
```

**Missing from production** (defined in migration but not applied):
- `credits_charged`
- `credits_reserved`
- `credits_refunded`

---

## What `agent-billing.ts` Actually Calls

| Call | RPC | Exists in prod? | Failure behavior |
|------|-----|-----------------|------------------|
| `reserveCredits()` | `reserve_credits` | ❌ NO | **Fail-closed** — aborts run |
| `settleRun()` refund | `refund_credits` | ❌ NO | Logs CRITICAL, creates reconciliation record |

### Corrected Failure Analysis

B1 said: "agent billing has been silently failing in production"

**Corrected:** Agent billing fails **loudly** — `reserve_credits` does not exist, so the call errors with "function not found", and the code has fail-closed behavior that aborts the run. The `charge_credits` RPC with its `EXCEPTION WHEN OTHERS THEN NULL` swallowing was **never deployed**, so that silent-failure path is not active.

The practical effect: **agent billing has never successfully reserved credits in production** because the RPC doesn't exist. Runs that require billing would abort at the reservation step.

---

## Implications for B2

1. **The canonical ledger path IS working** — `grant_credits`, `debit_credits`, `get_user_balances` are deployed and have real data
2. **The agent billing path is broken** — calls non-existent RPCs, fails closed
3. **`users.credits` is vestigial** — never mutated, just default 50 for every user
4. **`wallets` is legacy** — 6 rows with balance=500 but sub-balances all 0; not receiving new logic
5. **`agent_runs` lacks billing columns** — the migration that adds them was never applied

### B2 should:
- Add `reserve_bits`, `settle_bits`, `release_bits` RPCs following the pattern of the existing `grant_credits`/`debit_credits` (advisory lock, idempotency, credit_ledger)
- Add `credit_reservations` table
- Migrate `agent-billing.ts` to use the new RPCs
- **NOT** drop `users.credits` (it's vestigial but harmless)
- **NOT** drop `wallets` (legacy, but has data)
- **NOT** apply the full 9-table B1 schema — only what's needed for reserve/settle/release
