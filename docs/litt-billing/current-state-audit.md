# LiTT Billing / Monetization — Current State Audit (B0)

**Date:** 2026-08-13
**Phase:** B0 (audit only — no code changes)
**Auditor:** Devin (automated)
**Branch:** `feat/litt-os-kernel-phase1`

---

## Executive Summary

LiTT already has a **mature, partially-production billing system** with atomic credit ledger RPCs, Stripe webhook integration, LLM cost engines, generation cost engines, and entitlement resolution. However, the system has **critical architectural debts** that must be addressed before building the full BITS platform described in the master directive:

1. **Two parallel credit systems** — the canonical `credit_ledger` (append-only, journaled) coexists with a `users.credits` column mutated by `reserve_credits`/`refund_credits`/`charge_credits` RPCs that bypass the ledger entirely.
2. **Three separate cost engines** — `llm-cost-engine.ts`, `generation/cost-engine.ts`, and `usage-costs.ts` each define pricing independently with different units (micro-USD vs cents vs flat BITS).
3. **No reservation system for concurrent spend** — `agent-billing.ts` has a reserve→settle flow but it operates on the wrong table (`users.credits`) and lacks advisory locking.
4. **No public API billing** — API key schema exists but no authentication middleware or usage metering is implemented.
5. **No server-enforced spend controls** — budget limits exist in UI/settings only (localStorage), not enforced server-side.
6. **No entitlements table** — entitlements are resolved from plan rank + subscription status, not stored as separate grant records.
7. **No billability classification** — failed runs, retries, and provider failures are not systematically classified for billing exemption.
8. **No margin analytics** — `llm_usage_records` tracks `platform_margin` but no aggregation/reporting exists.

---

## 1. Canonical Credit Ledger (REUSABLE — primary BITS store)

### Table: `credit_ledger`
**Migration:** `supabase/migrations/20260725000000_credit_ledger_beta_pricing.sql`
**Unified in:** `supabase/migrations/20260726193000_unify_litbits_ledger.sql`

```sql
CREATE TABLE public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  category TEXT NOT NULL CHECK (category IN (
    'subscription_grant', 'beta_grant', 'purchase',
    'usage', 'refund', 'adjustment', 'promotion'
  )),
  balance_bucket TEXT NOT NULL CHECK (balance_bucket IN (
    'monthly', 'purchased', 'beta_promotional'
  )),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL UNIQUE
);
```

**Classification: CANONICAL / REUSABLE**

This is a well-designed append-only ledger with:
- Unique `idempotency_key` constraint (duplicate-safe)
- `expires_at` for time-limited credits
- `balance_bucket` for credit type separation
- `reference_type`/`reference_id` for correlation
- RLS enabled (service_role only)

### RPC: `grant_credits`
**Classification: CANONICAL / REUSABLE**

- Atomic: `pg_advisory_xact_lock` per user
- Idempotent: checks `idempotency_key` before insert
- Categories: `subscription_grant`, `beta_grant`, `purchase`, `refund`, `adjustment`, `promotion`
- Buckets: `monthly`, `purchased`, `beta_promotional`
- Returns: `(granted BOOLEAN, total_after INTEGER)`

### RPC: `debit_credits`
**Classification: CANONICAL / REUSABLE**

- Atomic: `pg_advisory_xact_lock` per user
- Idempotent: checks `idempotency_key` prefix pattern
- Consumption order: **monthly → beta_promotional → purchased**
- Returns: `(success BOOLEAN, remaining INTEGER)`
- Rejects if insufficient balance (returns `success=false`)

### RPC: `get_user_balances`
**Classification: CANONICAL / REUSABLE**

- Pure read function (STABLE)
- Returns: `(monthly, purchased, beta_promotional, total)`
- Respects `expires_at` (expired credits excluded)

### Gap vs. Master Directive

| Directive Requirement | Current State |
|----------------------|---------------|
| Append-only journal | ✅ Yes |
| Idempotency keys | ✅ Yes |
| Grant types (PURCHASED, SUBSCRIPTION, PROMOTIONAL, COMPENSATION, ENTERPRISE_COMMIT, ADMIN) | ⚠️ Partial — has `purchase`, `subscription_grant`, `promotion`, `adjustment`, `beta_grant`, `refund`, `usage`. Missing: `COMPENSATION`, `ENTERPRISE_COMMIT` |
| Reservation entries (RESERVE, RELEASE) | ❌ Missing — no reservation journal entries |
| Per-grant tracking (grantId, originalBits, remainingBits, priority) | ❌ Missing — grants are flat ledger entries, not tracked individually |
| Deterministic spend ordering (oldest-expiring first) | ⚠️ Partial — bucket ordering is fixed (monthly→beta→purchased), not expiration-based |
| `runId` correlation on every entry | ❌ Missing — `reference_type`/`reference_id` exist but no `run_id` column |
| `usageEventId` correlation | ❌ Missing — no `usage_event_id` column |

---

## 2. DUPLICATE Credit System — `users.credits` (UNSAFE)

### RPC: `reserve_credits`
**Migration:** `supabase/migrations/20260803100000_evolve_user_agents_instances.sql` (lines 181-202)
**Classification: UNSAFE / DUPLICATE**

```sql
CREATE OR REPLACE FUNCTION public.reserve_credits(
  p_user_id UUID, p_credits INTEGER
) RETURNS VOID AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_credits <= 0 THEN RETURN; END IF;
  SELECT COALESCE(credits, 0) INTO v_balance
  FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF v_balance < p_credits THEN
    RAISE EXCEPTION 'insufficient balance: have %, need %', v_balance, p_credits;
  END IF;
  UPDATE public.users
  SET credits = v_balance - p_credits, updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Problems:**
1. Mutates `users.credits` column directly — **bypasses `credit_ledger` entirely**
2. No journal entry — no audit trail
3. No idempotency key — retries can double-debit
4. No bucket awareness — ignores monthly/purchased/beta_promotional separation
5. `users.credits` column is not in `schema.sql` — may not exist in all environments
6. Used by `agent-billing.ts` which is called from Studio conversations

### RPC: `refund_credits`
**Migration:** Same file (lines 208-227)
**Classification: UNSAFE / DUPLICATE**

- Adds credits back to `users.credits` (not ledger)
- "Idempotent" only in that it checks if `agent_runs` row exists — no idempotency key
- No journal entry

### RPC: `charge_credits`
**Migration:** Same file (lines 141-175)
**Classification: UNSAFE / DUPLICATE**

- Direct `UPDATE users SET credits = ...`
- Idempotency check via `credits_charged` column on `agent_runs`
- No journal entry, no bucket awareness

### Caller: `src/lib/agent-billing.ts`
**Classification: CANONICAL intent / UNSAFE implementation**

The `reserveCredits()` → `settleRun()` flow is architecturally correct (reserve before execute, settle after) but routes through the wrong RPCs. It should use `credit_ledger` with RESERVE/RELEASE/DEBIT journal entries.

**Called from:** `src/app/api/studio/conversations/[conversationId]/messages/route.ts`

---

## 3. Legacy Wallet System (LEGACY — compatibility only)

### Table: `wallets`
**File:** `supabase/schema.sql` (lines 72-81)

```sql
CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  balance integer DEFAULT 500 NOT NULL,
  last_claim_date date,
  created_at timestAMPTZ DEFAULT now(),
  updated_at timestAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);
```

**Classification: LEGACY**

- Pre-ledger single-balance system
- `balance` column mutated by `adjust_wallet_balance` RPC (migration `20260714010000`)
- Migration `20260726193000` migrated legacy balances to `credit_ledger` as `beta_grant` entries
- Still has `monthly_balance`, `purchased_balance`, `beta_balance` columns added by `20260725000000`
- **Must not be used for new billing logic**

### Table: `transactions`
**Classification: LEGACY**

- Pre-ledger transaction log
- Used by `adjust_wallet_balance` RPC for idempotency
- **Must not be used for new billing logic**

### RPC: `adjust_wallet_balance`
**Migration:** `supabase/migrations/20260714010000_atomic_wallet_adjustments.sql`
**Classification: LEGACY**

- Atomic, idempotent (checks transactions metadata)
- Mutates `wallets.balance` directly
- Still called by `wallet-ledger.ts` `adjustWalletBalance()` for debit path
- **Should be deprecated in favor of `debit_credits`/`grant_credits`**

### Caller: `src/lib/wallet-ledger.ts`
**Classification: CANONICAL wrapper / MIXED implementation**

`adjustWalletBalance()` routes:
- **Debit** → `debit_credits` RPC (canonical ledger) ✅
- **Credit** → `grant_credits` RPC (canonical ledger) ✅
- But the function signature and types still reference the legacy `WalletAdjustment` shape

`getCreditBalances()` is fully canonical (uses `get_user_balances` RPC).

---

## 4. Cost Engines (THREE SEPARATE SYSTEMS)

### 4a. LLM Cost Engine
**File:** `src/lib/llm-cost-engine.ts`
**Classification: CANONICAL / REUSABLE**

- **Unit:** USD micros (`providerCostMicros`) for provider cost
- **Retail:** LiTTBits (integer)
- **Margin:** Configurable via `LLM_COST_MARGIN_TARGET` env (default 50%)
- **Shadow mode:** `LLM_COST_SHADOW_MODE=true` (calculate but don't debit)
- **BYOK:** Returns `retailLiTTBits: 0, shouldDebit: false`
- **Catalog:** Hardcoded `COST_CATALOG` array with provider/model/rates
- **Exchange rate:** $1.00 ≈ 1000 BITS (internal, line 279)
- **Formula:** `retailLiTTBits = costEquivalentBits * (1 + marginTarget) + baseBits * 0.1`

### 4b. Generation Cost Engine
**File:** `src/lib/generation/cost-engine.ts`
**Classification: CANONICAL / REUSABLE**

- **Unit:** USD cents (`providerCostCents`) for provider cost
- **Retail:** LiTTBits (integer)
- **Exchange rate:** 1 LiTTBit = $0.01 (100 LiTTBits = $1.00) — **DIFFERENT from LLM engine!**
- **Margin:** 50% default (configurable per-call)
- **Infra allowance:** $0.01 per generation
- **Formula:** `retailBits = ceil((providerCostCents + infraAllowanceCents) * (1 + marginPercent/100) / CENTS_PER_BIT)`
- **Catalog:** `PROVIDER_COST_CENTS` record + `LITT_PRODUCTS` array

### 4c. Usage Cost Constants
**File:** `src/config/usage-costs.ts`
**Classification: PARTIAL / LEGACY**

- **Unit:** Flat LiTTBits per category
- **No provider cost tracking**
- **No margin calculation**
- **Hardcoded:** `chat.free: 1`, `chat.fast: 3`, `chat.premium: 8`, `image.standard: 10`, `video.generate: 50`, etc.
- **Not versioned**
- **Not used by the actual billing path** (LLM billing uses `llm-cost-engine.ts`, generation uses `generation/cost-engine.ts`)

### Critical Inconsistency: Exchange Rate Mismatch

| Engine | Exchange Rate |
|--------|--------------|
| LLM Cost Engine | $1.00 ≈ 1000 BITS |
| Generation Cost Engine | $1.00 = 100 BITS |
| Usage Cost Constants | No exchange rate (flat BITS) |

**This means the same $1 of provider cost charges 10x more BITS depending on which engine processes it.** This must be unified.

---

## 5. Usage Tracking

### Table: `llm_usage_records`
**Migration:** `supabase/migrations/20260811000000_llm_usage_records.sql`
**Classification: CANONICAL / REUSABLE**

- Per-LLM-call tracking
- Fields: `clerk_id`, `provider`, `model`, `prompt_tokens`, `completion_tokens`, `is_byok`, `billing_class`, `provider_cost_micros`, `retail_littbits`, `platform_margin`, `shadow_mode`, `was_debited`, `balance_after`, `call_id`
- RLS: users can only see their own records
- **Gap:** No `run_id`, `tenant_id`, `idempotency_key`, `capability`, `compute_ms`, `storage_bytes`, `network_bytes`, `tool_calls` fields

### Table: `generation_jobs`
**Migration:** `supabase/migrations/20260811000000_generation_jobs.sql`
**Classification: CANONICAL / REUSABLE**

- Per-generation tracking
- Fields: `user_id`, `modality`, `provider`, `model`, `prompt`, `request_id`, `provider_job_id`, `actual_provider_cost_cents`, `littbits_charged`, `refund_status`, `asset_id`, `error`, `status`, `metadata`
- Unique index on `(user_id, request_id)` for idempotency
- **Gap:** No `run_id`, `tenant_id`, `compute_ms`, `storage_bytes`, `network_bytes` fields

### Table: `terminal_usage`
**Migration:** `supabase/migrations/20260802020000_terminal_usage.sql`
**Classification: CANONICAL / REUSABLE (terminal-specific)**

- Per-user per-billing-period tracking
- Fields: `sandbox_hours`, `storage_gb_hours`, `preview_port_hours`, `max_concurrent_sandboxes`
- **Gap:** Not correlated to `credit_ledger` debits

### Table: `agent_runs`
**Migration:** `supabase/migrations/20250704144500_agent_runs.sql` (evolved in `20260803100000`)
**Classification: PARTIAL**

- Fields: `user_id`, `agent_instance_id`, `agent_id`, `agent_version_id`, `conversation_id`, `message_id`, `idempotency_key`, `model`, `provider`, `credits_charged`, `input_tokens`, `output_tokens`, `status`, `started_at`, `completed_at`, `error`
- **Gap:** `credits_charged` is the reserved amount, not the settled amount. No `actual_credits_charged` column. No `provider_cost` column. No `rating_event_id`.

### Gap vs. Master Directive

The directive requires a unified `UsageEvent` with:
- `tenantId` — ❌ Missing (no tenant concept)
- `runId` — ⚠️ Partial (`agent_runs.id` for agent runs, `call_id` for LLM, `request_id` for generations — not unified)
- `capability` — ❌ Missing
- `cachedInputTokens` — ❌ Missing
- `computeMs` — ❌ Missing
- `runtimeSeconds` — ❌ Missing
- `imageCount`/`videoSeconds`/`audioSeconds` — ❌ Missing (modality-specific fields not in unified schema)
- `storageBytes`/`networkBytes` — ❌ Missing
- `toolCalls` — ❌ Missing
- `providerRequestId` — ⚠️ Partial (`provider_job_id` for generations, `call_id` for LLM)
- `idempotencyKey` — ⚠️ Partial (on `agent_runs` and via `credit_ledger`, not on usage records)

---

## 6. Stripe Integration (CANONICAL / REUSABLE)

### Webhook Handler
**File:** `src/app/api/stripe/webhook/route.ts` (597 lines)
**Classification: CANONICAL / SECURE**

- ✅ Signature verification (`stripe.webhooks.constructEvent`)
- ✅ Idempotency (`stripe_events` table, unique `stripe_event_id`)
- ✅ Replay protection (returns `{ received: true, replayed: true }`)
- ✅ Events handled: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `payment_intent.succeeded`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`
- ✅ Credit pack grants via `grant_credits` RPC
- ✅ Subscription grants via `grant_credits` RPC (on `invoice.paid` only)
- ✅ Refund debits via `debit_credits` RPC
- ✅ Agent purchase fulfillment via `fulfill_agent_purchase` RPC
- ⚠️ Some errors silently caught (lines 64-67, 543-545)

### Stripe Events Table
**Migration:** `supabase/migrations/20260725000000_credit_ledger_beta_pricing.sql` (lines 46-61)
**Classification: CANONICAL / REUSABLE**

```sql
CREATE TABLE public.stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT,
  metadata JSONB
);
```

### Billing Routes

| Route | File | Status |
|-------|------|--------|
| POST `/api/billing/checkout` | `src/app/api/billing/checkout/route.ts` | CANONICAL — plan subscriptions |
| POST `/api/billing/portal` | `src/app/api/billing/portal/route.ts` | CANONICAL — Stripe customer portal |
| GET `/api/billing/subscription` | `src/app/api/billing/subscription/route.ts` | CANONICAL — current plan + balances |
| POST `/api/marketplace/agents/[id]/checkout` | `src/app/api/marketplace/agents/[id]/checkout/route.ts` | CANONICAL — agent purchases |
| POST `/api/stripe/checkout` | `src/app/api/stripe/checkout/route.ts` | ORPHANED — empty product catalog |
| GET `/api/stripe/session` | `src/app/api/stripe/session/route.ts` | PARTIAL — receipt display |

### Stripe Products Catalog
**File:** `src/config/stripe-products.ts`
**Classification: FROZEN / EMPTY**

- `Object.freeze({})` — intentionally no credit pack products approved
- Validation logic exists but catalog is empty
- Architecture is sound for future use

---

## 7. Plans & Entitlements

### Plan Definitions
**File:** `src/config/plans.ts`
**Classification: CANONICAL / REUSABLE**

| Plan | Price | Credits | Project Limit | Billing Type |
|------|-------|---------|---------------|-------------|
| starter | Free | 500 (one-time) | 1 | free |
| creator_beta | $15/mo | 6,000/cycle | 5 | subscription |
| pro_builder_beta | $39/mo | 20,000/cycle | 25 | subscription |
| founder | $149 one-time | 0 | 5 | one_time |
| owner | Internal | 250,000 | 999,999 | free (not purchasable) |

**Critical Issue:** Documentation (`docs/STRIPE_CATALOG_WIRING.md`) says Creator Beta is $7/mo and Pro Builder is $19/mo, but code says $15/mo and $39/mo. **This must be resolved.**

### Product Truth
**File:** `src/config/product-truth.ts`
**Classification: CANONICAL / REUSABLE**

- Mirrors `plans.ts` pricing
- Defines `creditGrantFrequency`: `once` (starter), `per_billing_cycle` (creator/pro), `none` (founder)
- Plan rank: starter(0) < creator_beta(1) = founder(1) < pro_builder_beta(2) < owner(999)

### Entitlements System
**File:** `src/lib/entitlements.ts`
**Classification: CANONICAL / REUSABLE (but limited)**

- Resolves entitlements from subscription plan
- Returns `Entitlements` object with feature flags
- Owner override: `OWNER_ENTITLEMENTS` (all features, 250K credits)
- Owner simulation: can simulate starter/creator/pro/zero_bits via cookie

**Gap vs. Master Directive:**
- No separate `Entitlement` records per feature
- No `effectiveAt`/`expiresAt` on entitlements
- No `planSource` tracking
- No `limits` object (just boolean flags + project limit)
- Entitlements are derived, not stored as grant records

### Agent Entitlements
**File:** `src/lib/agent-entitlements.ts`
**Classification: CANONICAL / REUSABLE**

- Checks plan rank against agent's `minimumPlan`
- Checks `agent_entitlements` table for individually purchased agents
- Owner simulation support
- **Does NOT charge LiTTBits** — billing is separate (via `agent-billing.ts`)

---

## 8. Owner / Internal Accounts

**File:** `src/lib/owner.ts`
**Classification: CANONICAL / WELL-DESIGNED**

- Owner identified by `LITTLABS_VAPI_OWNER_CLERK_ID` env var
- `OWNER_WALLET_TARGET = 250_000` LiTTBits
- Owner top-up uses **same audited ledger** (`adjustWalletBalance` → `grant_credits`)
- Owner can simulate customer tiers for testing
- **Does NOT bypass metering** — every operation still deducts normally

**Gap vs. Master Directive:**
- Directive says: "Create explicit internal/billing-exempt entitlements"
- Current: Owner gets 250K BITS topped up periodically — not truly exempt
- Current: Owner usage still records `llm_usage_records` with `was_debited: true`
- **Recommendation:** Add `billing_exempt` flag to entitlements, still meter usage but skip debit

---

## 9. Pricing Constants (FRAGMENTED)

### All Pricing Locations

| File | What | Unit | Status |
|------|------|------|--------|
| `src/lib/llm-cost-engine.ts` | LLM provider costs + retail BITS | micro-USD / BITS | CANONICAL |
| `src/lib/generation/cost-engine.ts` | Generation provider costs + retail BITS | cents / BITS | CANONICAL |
| `src/config/usage-costs.ts` | Flat BITS per category | BITS only | PARTIAL/LEGACY |
| `src/config/video-tiers.ts` | Video tier prices | BITS | CANONICAL |
| `src/lib/studio-models.ts` | Video/music model costs | BITS (integer) | CANONICAL |
| `src/lib/music/generation-service.ts` | Music generation costs | BITS | CANONICAL |
| `src/app/studio/tools/MusicTool.tsx` | Music costs (DUPLICATE) | BITS | DUPLICATE |
| `src/components/dashboard/AudioTool.tsx` | TTS/music costs | BITS | DUPLICATE |

### Duplicate Pricing Found

1. **`MUSIC_LBC_COST`** exists in both:
   - `src/lib/music/generation-service.ts` (lines 64-68) — canonical
   - `src/app/studio/tools/MusicTool.tsx` (lines 55-57) — duplicate

2. **`LITTBITS_COST`** hardcoded in `src/components/dashboard/AudioTool.tsx` (line 40):
   ```typescript
   const LITTBITS_COST: Record<Tab, number> = { tts: 2, music: 20 };
   ```

3. **Video model costs** in `src/lib/studio-models.ts` vs `src/config/video-tiers.ts` — different granularity

---

## 10. Spend Controls & Budgets

### Server-Enforced

| Control | Location | Status |
|---------|----------|--------|
| Credit balance check | `debit_credits` RPC | ✅ Enforced |
| Agent run reservation | `agent-billing.ts` | ⚠️ Enforced but via wrong table |
| Terminal concurrent sandboxes | `terminal-v1/quota-service.ts` | ✅ Enforced |
| Terminal monthly hours | `terminal-v1/quota-service.ts` | ✅ Enforced |
| Terminal storage | `terminal-v1/quota-service.ts` | ✅ Enforced |
| Rate limiting | `src/lib/rate-limiter.ts` | ✅ Enforced |
| Hourly command limit | `src/lib/usage.ts` (100/hr) | ✅ Enforced |

### NOT Server-Enforced

| Control | Location | Status |
|---------|----------|--------|
| Per-run maximum BITS | — | ❌ MISSING |
| Daily maximum BITS | `src/app/settings/page.tsx` (localStorage) | ❌ UI-only |
| Monthly maximum BITS | `src/app/settings/page.tsx` (localStorage) | ❌ UI-only |
| Organization maximum | — | ❌ MISSING |
| Model maximum | — | ❌ MISSING |
| Automation budget | — | ❌ MISSING |
| API key budget | — | ❌ MISSING |
| Video daily spend limit | `src/config/video-tiers.ts` (2000 LB) | ⚠️ Defined but commented out in route |
| Video global cutoff | `src/config/video-tiers.ts` (50000 LB) | ⚠️ Defined but not enforced |
| Low balance warning | — | ❌ MISSING |
| Auto-top-up | — | ❌ MISSING |
| Overage policy | — | ❌ MISSING |

### Per-Run Budget Columns (EXIST but UNUSED)

`user_agents` table has:
- `daily_budget_credits INTEGER NOT NULL DEFAULT 0`
- `per_run_budget_credits INTEGER NOT NULL DEFAULT 0`

`agent_work_queue` table has:
- `cost_cap_credits INTEGER NOT NULL DEFAULT 100`
- `credits_spent INTEGER NOT NULL DEFAULT 0`

**These columns exist but are not enforced in the billing path.**

---

## 11. API Monetization (MISSING)

### API Key Schema (EXISTS)
**Migration:** `supabase/migrations/20260630010000_invite_api_keys.sql`

```sql
CREATE TABLE api_keys (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  name text NOT NULL,
  prefix text NOT NULL,       -- e.g. "lit_live_ab12"
  key_hash text NOT NULL UNIQUE,  -- SHA-256
  scopes text[] NOT NULL DEFAULT '{}',
  last_used_at timestAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_key_usage (
  id uuid PRIMARY KEY,
  api_key_id uuid NOT NULL REFERENCES api_keys(id),
  endpoint text NOT NULL,
  status int,
  ip_hash text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Classification: CANONICAL schema / MISSING implementation**

### What's Missing

- ❌ No API key authentication middleware
- ❌ No `X-API-Key` header validation
- ❌ No public API v1 routes (`/api/v1/`)
- ❌ No API key → tenant resolution
- ❌ No API key → entitlement check
- ❌ No API key → BITS reservation
- ❌ No API key budget enforcement
- ❌ No API usage metering (table exists but unused)
- ❌ No `GET /v1/usage`, `GET /v1/balance`, `GET /v1/cost-estimate`

---

## 12. BYOK (PARTIAL)

### What Exists

- ✅ BYOK type definitions in `src/lib/llm.ts` (`userApiKey`, `byokProvider`)
- ✅ BYOK cost engine support (`billingClass: "byok"`, `retailLiTTBits: 0`)
- ✅ BYOK billing support (skip charge, record for audit)
- ✅ BYOK model aliases in UI (`GPT-4o (BYOK)`, `Claude Sonnet (BYOK)`)

### What's Missing

- ❌ No BYOK key storage (no table for user's OpenAI/Anthropic keys)
- ❌ No BYOK key encryption at rest
- ❌ No BYOK key validation (test call before saving)
- ❌ No BYOK orchestration charge (LiTT still charges $0 for BYOK — directive says charge platform fee)
- ❌ No BYOK provider commercial policy metadata

---

## 13. Billability & Failure Handling (PARTIAL)

### What Exists

- `agent-billing.ts` `settleRun()`: if `status === "failed"`, `creditsToCharge = 0` (full refund)
- `music/generation-service.ts`: `failGeneration()` refunds via `grant_credits`
- `generation_jobs` table has `refund_status` column
- `billing_reconciliations` table tracks failed refund/settlement operations

### What's Missing

- ❌ No `billableCause` classification (`customer_usage`, `customer_cancel`, `system_failure`, `provider_failure`, `retry_internal`, `promotional`)
- ❌ No systematic retry cost absorption
- ❌ No duplicate detection for retried requests (beyond idempotency keys)
- ❌ No partial result billing
- ❌ No provider outage handling policy
- ❌ No automated reconciliation retry job

---

## 14. Reconciliation

### Table: `billing_reconciliations`
**Migration:** `supabase/migrations/20260803110100_billing_reconciliations.sql`
**Classification: CANONICAL / REUSABLE**

- Tracks failed refund/settlement operations
- Fields: `idempotency_key`, `agent_instance_id`, `credits_expected`, `reason`, `error_message`, `status`
- Status: `pending`, `resolved`, `failed`
- **Gap:** No automated retry job. No `retry_count` column. No `next_retry_at` column.

---

## 15. Creator Payout Ledger (EXISTS — separate from BITS)

### Table: `creator_payout_ledger`
**Migration:** `supabase/migrations/20260811010000_creator_payout_ledger.sql`
**Classification: CANONICAL / REUSABLE**

```sql
CREATE TABLE creator_payout_ledger (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  customer_clerk_id text NOT NULL,
  customer_charge_bits integer NOT NULL DEFAULT 0,
  provider_cost_bits integer NOT NULL DEFAULT 0,
  net_revenue integer NOT NULL DEFAULT 0,
  creator_share integer NOT NULL DEFAULT 0,
  platform_share integer NOT NULL DEFAULT 0,
  transaction_id text NOT NULL UNIQUE,
  payout_status text NOT NULL DEFAULT 'pending',
  paid_out_at timestAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- Tracks real money owed to creators (separate from user BITS)
- `payout_status`: `pending` → `paid_out`
- **Gap:** No automated payout processing. No minimum payout threshold. No tax form tracking.

---

## 16. UI Balance Displays

| Location | File | What It Shows |
|----------|------|---------------|
| Wallet page | `src/app/wallet/page.tsx` | Total balance, bucket breakdown |
| Wallet context | `src/context/WalletContext.tsx` | Auto-refresh every 30s |
| App shell | `src/components/AppShell.tsx` | Plan, balance in sidebar |
| Dashboard widget | `src/components/dashboard/widgets/DashboardWidgets.tsx` | "AI Credits" widget |
| Mission Control | `src/components/dashboard/v2/MissionControlDashboard.tsx` | "LiTTBits" metric |
| Studio header | `src/app/studio/components/CommandStudioHeader.tsx` | Balance in "Wallet" |
| Pricing page | `src/app/pricing/PricingClient.tsx` | Credits per plan |
| Settings | `src/app/settings/page.tsx` | Plan, balance, billing history |

**Classification: CANONICAL / REUSABLE**

**Gap:** No "reserved BITS" display. No cost-by-run breakdown. No cost-by-capability view. No estimated cost before expensive jobs. No low-balance warning UI. No top-up flow from wallet page.

---

## 17. Observability Correlation

### Current Correlation Chain

```
clerk_id → user_id (users table)
         → agent_runs.id (runId)
         → credit_ledger.idempotency_key (references runId)
         → llm_usage_records.call_id (separate from runId)
         → generation_jobs.request_id (separate from runId)
         → stripe_events.stripe_event_id
```

### Gap vs. Master Directive

The directive requires full correlation:
```
tenantId → userId → runId → usageEventId → ratingEventId
         → reservationId → journalEntryId → StripeEventId
         → StripeCustomerId → providerRequestId → pricingVersion
```

**Missing from current chain:**
- ❌ `tenantId` (no tenant concept)
- ❌ Unified `usageEventId` (separate IDs per system)
- ❌ `ratingEventId` (no rating events stored)
- ❌ `reservationId` (no reservation records)
- ❌ `journalEntryId` (credit_ledger has `id` but not referenced from usage)
- ❌ `pricingVersion` (cost catalogs are hardcoded, not versioned)

---

## 18. Complete File Inventory

### Canonical / Reusable

| File | Purpose |
|------|---------|
| `supabase/migrations/20260725000000_credit_ledger_beta_pricing.sql` | Credit ledger + Stripe events table + RPCs |
| `supabase/migrations/20260726193000_unify_litbits_ledger.sql` | Unified ledger RPCs with advisory locks |
| `supabase/migrations/20260811000000_llm_usage_records.sql` | LLM usage tracking table |
| `supabase/migrations/20260811000000_generation_jobs.sql` | Generation jobs table |
| `supabase/migrations/20260811010000_creator_payout_ledger.sql` | Creator payout ledger |
| `supabase/migrations/20260803110100_billing_reconciliations.sql` | Reconciliation table |
| `supabase/migrations/20260630010000_invite_api_keys.sql` | API key schema |
| `supabase/migrations/20260802020000_terminal_usage.sql` | Terminal usage tracking |
| `src/lib/llm-cost-engine.ts` | LLM cost calculation |
| `src/lib/llm-billing.ts` | LLM billing bridge |
| `src/lib/generation/cost-engine.ts` | Generation cost calculation |
| `src/lib/wallet-ledger.ts` | Wallet operations (canonical wrapper) |
| `src/lib/agent-billing.ts` | Agent billing (correct intent, wrong RPCs) |
| `src/lib/entitlements.ts` | Entitlement resolution |
| `src/lib/agent-entitlements.ts` | Agent entitlement resolution |
| `src/lib/owner.ts` | Owner identification + simulation |
| `src/lib/usage.ts` | Hourly command limit |
| `src/lib/terminal-v1/quota-service.ts` | Terminal quota enforcement |
| `src/lib/rate-limiter.ts` | Rate limiting |
| `src/config/plans.ts` | Plan definitions |
| `src/config/product-truth.ts` | Product truth contracts |
| `src/config/video-tiers.ts` | Video tier pricing |
| `src/config/stripe-products.ts` | Stripe product catalog (frozen) |
| `src/app/api/stripe/webhook/route.ts` | Stripe webhook handler |
| `src/app/api/billing/checkout/route.ts` | Plan subscription checkout |
| `src/app/api/billing/portal/route.ts` | Stripe customer portal |
| `src/app/api/billing/subscription/route.ts` | Current subscription info |
| `src/app/api/wallet/route.ts` | Wallet API |
| `src/app/api/usage/check/route.ts` | Usage limit check |
| `src/app/api/usage/stats/route.ts` | Usage stats |
| `src/app/api/litt/usage/route.ts` | LiTT usage |
| `src/app/api/users/[userId]/credits/route.ts` | User credits (admin) |
| `src/app/api/users/[userId]/plan/route.ts` | User plan (admin) |
| `src/context/WalletContext.tsx` | Wallet React context |
| `src/app/wallet/page.tsx` | Wallet page |

### Legacy / Deprecated

| File | Purpose | Action |
|------|---------|--------|
| `supabase/schema.sql` (wallets table) | Legacy single-balance wallet | Do not use for new code |
| `supabase/schema.sql` (transactions table) | Legacy transaction log | Do not use for new code |
| `supabase/migrations/20260714010000_atomic_wallet_adjustments.sql` | Legacy `adjust_wallet_balance` RPC | Deprecate |
| `src/config/usage-costs.ts` | Flat BITS per category | Replace with rating engine |
| `src/app/api/stripe/checkout/route.ts` | Orphaned (empty catalog) | Delete or repurpose |

### UNSAFE / Duplicate

| File | Issue | Action |
|------|-------|--------|
| `supabase/migrations/20260803100000_evolve_user_agents_instances.sql` (reserve_credits/refund_credits/charge_credits RPCs) | Mutates `users.credits` directly, bypasses credit_ledger, no journal | Replace with ledger-based reservation |
| `src/app/studio/tools/MusicTool.tsx` (MUSIC_LBC_COST) | Duplicates `generation-service.ts` | Import from canonical source |
| `src/components/dashboard/AudioTool.tsx` (LITTBITS_COST) | Hardcoded in component | Move to canonical config |

---

## 19. Architectural Debt Summary

### Critical (Must Fix Before B1)

1. **Two parallel credit systems** — `credit_ledger` (canonical) vs `users.credits` (unsafe). Agent billing uses the unsafe path.
2. **Exchange rate mismatch** — LLM engine: $1 = 1000 BITS; Generation engine: $1 = 100 BITS. Same provider cost charges 10x differently.
3. **No reservation journal** — `reserve_credits` deducts from `users.credits` without a RESERVE ledger entry. Concurrent runs can double-spend.
4. **Price documentation mismatch** — Code says $15/$39, docs say $7/$19.

### High Priority (Fix in B1-B5)

5. **No pricing versioning** — cost catalogs are hardcoded arrays, not versioned records. Historical reproducibility impossible.
6. **No unified UsageEvent** — usage is split across `llm_usage_records`, `generation_jobs`, `agent_runs`, `terminal_usage` with no common schema.
7. **No billability classification** — no `billableCause` field. Failed runs are refunded but not classified.
8. **No server-enforced spend controls** — budget limits are UI-only (localStorage).
9. **No entitlement grant records** — entitlements are derived from plan, not stored as individual grants with expiration.
10. **No rating event storage** — `RatingEvent` with `pricingVersion`, `loadedCost`, `targetMargin`, `realizedMargin` does not exist.

### Medium Priority (Fix in B6-B11)

11. **No API key authentication** — schema exists, no middleware.
12. **No public API v1** — no routes for external developers.
13. **No BYOK key storage** — infrastructure exists, no key management.
14. **No BYOK platform fee** — BYOK charges $0, directive says charge orchestration fee.
15. **No automated reconciliation** — table exists, no retry job.
16. **No margin analytics** — data collected, no aggregation/reporting.
17. **No Campaign OS cost separation** — no separation of BITS from ad spend.

### Low Priority (Fix in B12-B13)

18. **No provider commercial policy metadata** — no per-provider compliance tracking.
19. **No enterprise commit tracking** — no `ENTERPRISE_COMMIT` grant type.
20. **No compensation grant type** — no `COMPENSATION` category.

---

## 20. What Can Be Reused vs. What Must Be Built

### Reuse As-Is

- `credit_ledger` table schema (extend with new columns)
- `grant_credits` / `debit_credits` / `get_user_balances` RPCs (extend for new entry types)
- `stripe_events` table + webhook handler (extend for new event types)
- `llm_usage_records` table (extend with missing fields)
- `generation_jobs` table (extend with missing fields)
- `billing_reconciliations` table (extend with retry fields)
- `api_keys` + `api_key_usage` schema
- `terminal_usage` table
- `creator_payout_ledger` table
- Plan definitions in `plans.ts` (add new plans)
- Entitlement resolution in `entitlements.ts` (add grant-based entitlements)
- Owner identification in `owner.ts`
- Rate limiter
- Terminal quota service

### Reuse With Modification

- `llm-cost-engine.ts` — unify exchange rate, add pricing versioning
- `generation/cost-engine.ts` — unify exchange rate, add pricing versioning
- `wallet-ledger.ts` — remove legacy `adjustWalletBalance` path
- `agent-billing.ts` — replace `reserve_credits`/`refund_credits` with ledger-based reservation
- Stripe webhook — add new event types for credit pack top-ups

### Build New

- **BITS reservation service** — RESERVE/RELEASE journal entries with atomic locking
- **Unified UsageEvent table** — common schema across all modalities
- **CostEvent table** — provider cost in micro-USD with rate card version
- **RatingEvent table** — customer pricing with pricing version + margin
- **PricingCatalog table** — versioned pricing records (replaces hardcoded catalogs)
- **Entitlement grant records** — per-feature entitlements with expiration
- **Spend control service** — server-enforced per-run/daily/monthly budgets
- **API key authentication middleware** — `X-API-Key` validation + tenant resolution
- **Public API v1 routes** — `/api/v1/usage`, `/api/v1/balance`, `/api/v1/cost-estimate`
- **BYOK key storage** — encrypted user key management
- **Provider commercial policy** — per-provider compliance metadata
- **Margin analytics aggregation** — daily/monthly margin reports
- **Reconciliation retry job** — automated retry of failed billing operations
- **Billability classifier** — `billableCause` assignment per usage event

---

## 21. Recommended B1 Architecture (Preview — do not implement yet)

Based on the audit, B1 should:

1. **Extend `credit_ledger`** with:
   - `run_id UUID` column
   - `usage_event_id UUID` column
   - `reservation_id UUID` column
   - `grant_id UUID` column (for per-grant tracking)
   - `pricing_version TEXT` column
   - New categories: `COMPENSATION`, `ENTERPRISE_COMMIT`
   - New entry types for reservation: `RESERVE`, `RELEASE` (via `direction` + `category`)

2. **Create `credit_grants` table** for per-grant tracking:
   - `grant_id`, `user_id`, `type`, `original_bits`, `remaining_bits`, `priority`, `effective_at`, `expires_at`, `applicable_capabilities`

3. **Create unified `usage_events` table** (superset of `llm_usage_records` + `generation_jobs`):
   - All fields from directive's `UsageEvent`
   - `billable_cause` classification
   - `pricing_version` correlation

4. **Create `cost_events` table** for provider costs:
   - `usage_event_id`, `provider_cost_micros`, `compute_cost_micros`, `storage_cost_micros`, `network_cost_micros`, `total_cost_micros`, `rate_card_version`

5. **Create `rating_events` table** for customer pricing:
   - `usage_event_id`, `pricing_version`, `raw_cost_micros`, `loaded_cost_micros`, `target_margin_bps`, `rated_price_micros`, `bits_charged`, `discount_id`, `plan_id`

6. **Create `pricing_catalog` table** for versioned pricing:
   - `provider`, `model`, `capability`, `unit`, `provider_rate`, `customer_rate`, `effective_from`, `effective_until`, `pricing_version`

7. **Unify exchange rate** to: **1,000 BITS ≈ $1.00** (as per directive)

8. **Create reservation RPCs** on `credit_ledger`:
   - `reserve_bits(user_id, run_id, estimated_bits)` → returns `reservation_id`
   - `settle_bits(reservation_id, actual_bits)` → debits actual, releases remainder
   - `release_bits(reservation_id)` → full release (failure/cancel)

9. **Add `billing_exempt` flag** to entitlements for internal accounts

10. **Do NOT change runtime behavior** — add new tables/RPCs alongside existing ones

---

## STOP

This audit is complete. No code has been modified. No migrations have been applied. No pushes or merges have been performed.

**Awaiting review before B1.**
