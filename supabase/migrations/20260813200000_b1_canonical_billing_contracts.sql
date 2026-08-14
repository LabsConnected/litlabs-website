-- ─────────────────────────────────────────────────────────────────────
-- B1: Canonical Billing Foundation — Proposed Schema Extensions
-- ─────────────────────────────────────────────────────────────────────
--
-- STATUS: PROPOSED — DO NOT APPLY YET
--
-- This migration extends the existing credit_ledger and adds new tables
-- for the canonical billing foundation. It does NOT:
--   - Delete or modify existing tables
--   - Change runtime behavior
--   - Migrate data
--   - Remove legacy RPCs
--
-- All new tables and columns are ADDITIVE. Existing code continues to work.
--
-- ─────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════
-- 1. EXTEND credit_ledger with correlation columns
-- ═══════════════════════════════════════════════════════════════════════

-- Add columns for the canonical correlation chain:
--   runId → usageEventId → reservationId → grantId → pricingVersion

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS usage_event_id UUID;
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS reservation_id UUID;
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS grant_id UUID;
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS pricing_version TEXT;
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS exchange_rate_version TEXT;
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS provider_cost_micros BIGINT;
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS entry_type TEXT;  -- LedgerEntryType (canonical)

-- Add entry_type values to the existing category constraint via a new column.
-- The existing `category` column remains for backward compatibility.
-- `entry_type` is the canonical type (GRANT, PURCHASE, RESERVE, SETTLE, etc.)

ALTER TABLE public.credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_entry_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_ledger_entry_type_check'
      AND conrelid = 'public.credit_ledger'::regclass
  ) THEN
    ALTER TABLE public.credit_ledger
      ADD CONSTRAINT credit_ledger_entry_type_check CHECK (
        entry_type IS NULL OR entry_type IN (
          'GRANT', 'PURCHASE', 'PROMO', 'RESERVE', 'SETTLE',
          'RELEASE', 'REFUND', 'ADJUSTMENT', 'EXPIRATION'
        )
      );
  END IF;
END;
$$;

-- Add new bucket values
-- Existing constraint only allows: monthly, purchased, beta_promotional
-- We need to add: compensation, enterprise_commit, admin
-- This requires dropping and recreating the constraint.

ALTER TABLE public.credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_balance_bucket_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_ledger_balance_bucket_check'
      AND conrelid = 'public.credit_ledger'::regclass
  ) THEN
    ALTER TABLE public.credit_ledger
      ADD CONSTRAINT credit_ledger_balance_bucket_check CHECK (
        balance_bucket IN (
          'monthly', 'purchased', 'beta_promotional',
          'compensation', 'enterprise_commit', 'admin'
        )
      );
  END IF;
END;
$$;

-- Indexes for correlation queries
CREATE INDEX IF NOT EXISTS credit_ledger_run_id
  ON public.credit_ledger(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_usage_event_id
  ON public.credit_ledger(usage_event_id) WHERE usage_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_reservation_id
  ON public.credit_ledger(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_entry_type
  ON public.credit_ledger(entry_type) WHERE entry_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_pricing_version
  ON public.credit_ledger(pricing_version) WHERE pricing_version IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. credit_reservations — MOVED to B2 (20260814200000)
-- ═══════════════════════════════════════════════════════════════════════
-- The credit_reservations table and its RPCs (reserve_bits, settle_bits,
-- release_bits) are defined in the B2 migration with a different schema.
-- B1's version was never applied to production and has been removed to
-- avoid schema conflicts during migration replay.

-- ═══════════════════════════════════════════════════════════════════════
-- 3. credit_grants — per-grant tracking with priority and expiration
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.credit_grants (
  grant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'PURCHASED', 'SUBSCRIPTION', 'PROMOTIONAL',
    'COMPENSATION', 'ENTERPRISE_COMMIT', 'ADMIN'
  )),
  original_bits INTEGER NOT NULL CHECK (original_bits > 0),
  remaining_bits INTEGER NOT NULL DEFAULT 0 CHECK (remaining_bits >= 0),
  priority INTEGER NOT NULL DEFAULT 0,
  applicable_capabilities TEXT[],
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_grants_user_id
  ON public.credit_grants(user_id);
CREATE INDEX IF NOT EXISTS credit_grants_user_priority
  ON public.credit_grants(user_id, priority DESC);
CREATE INDEX IF NOT EXISTS credit_grants_expires
  ON public.credit_grants(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.credit_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_grants_deny_anon ON public.credit_grants;
CREATE POLICY credit_grants_deny_anon
  ON public.credit_grants FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS credit_grants_deny_authenticated ON public.credit_grants;
CREATE POLICY credit_grants_deny_authenticated
  ON public.credit_grants FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. usage_events — unified immutable usage ledger
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.usage_events (
  usage_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  run_id UUID,
  project_id UUID,

  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  capability TEXT NOT NULL,

  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,

  compute_ms INTEGER NOT NULL DEFAULT 0,
  runtime_seconds NUMERIC(10,3) NOT NULL DEFAULT 0,

  image_count INTEGER NOT NULL DEFAULT 0,
  video_seconds NUMERIC(10,3) NOT NULL DEFAULT 0,
  audio_seconds NUMERIC(10,3) NOT NULL DEFAULT 0,

  storage_bytes BIGINT NOT NULL DEFAULT 0,
  network_bytes BIGINT NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,

  provider_request_id TEXT,

  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,

  idempotency_key TEXT NOT NULL,

  billability_cause TEXT NOT NULL DEFAULT 'USER_REQUEST',
  billable BOOLEAN NOT NULL DEFAULT true,
  liitt_absorbed BOOLEAN NOT NULL DEFAULT false,
  meter_provider_cost BOOLEAN NOT NULL DEFAULT true,
  retry_sequence INTEGER NOT NULL DEFAULT 0,
  original_request_id TEXT,

  is_byok BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_idempotency_key_unique
  ON public.usage_events(idempotency_key);
CREATE INDEX IF NOT EXISTS usage_events_user_id
  ON public.usage_events(user_id);
CREATE INDEX IF NOT EXISTS usage_events_run_id
  ON public.usage_events(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_provider_model
  ON public.usage_events(provider, model);
CREATE INDEX IF NOT EXISTS usage_events_capability
  ON public.usage_events(capability);
CREATE INDEX IF NOT EXISTS usage_events_started_at
  ON public.usage_events(started_at DESC);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_events_deny_anon ON public.usage_events;
CREATE POLICY usage_events_deny_anon
  ON public.usage_events FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS usage_events_deny_authenticated ON public.usage_events;
CREATE POLICY usage_events_deny_authenticated
  ON public.usage_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. cost_events — what LiTT paid (provider cost in micro-USD)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_event_id UUID NOT NULL REFERENCES public.usage_events(usage_event_id) ON DELETE CASCADE,
  provider_cost_micros BIGINT NOT NULL DEFAULT 0,
  compute_cost_micros BIGINT NOT NULL DEFAULT 0,
  storage_cost_micros BIGINT NOT NULL DEFAULT 0,
  network_cost_micros BIGINT NOT NULL DEFAULT 0,
  tool_cost_micros BIGINT NOT NULL DEFAULT 0,
  total_cost_micros BIGINT NOT NULL DEFAULT 0,
  rate_card_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cost_events_usage_event_id
  ON public.cost_events(usage_event_id);

ALTER TABLE public.cost_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_events_deny_anon ON public.cost_events;
CREATE POLICY cost_events_deny_anon
  ON public.cost_events FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS cost_events_deny_authenticated ON public.cost_events;
CREATE POLICY cost_events_deny_authenticated
  ON public.cost_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. rating_events — what the customer was charged
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rating_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_event_id UUID NOT NULL REFERENCES public.usage_events(usage_event_id) ON DELETE CASCADE,
  pricing_version_id TEXT NOT NULL,
  exchange_rate_version_id TEXT NOT NULL,
  raw_cost_micros BIGINT NOT NULL DEFAULT 0,
  loaded_cost_micros BIGINT NOT NULL DEFAULT 0,
  target_margin_bps INTEGER NOT NULL DEFAULT 0,
  rated_price_micros BIGINT NOT NULL DEFAULT 0,
  bits_charged INTEGER NOT NULL DEFAULT 0,
  realized_margin_bps INTEGER NOT NULL DEFAULT 0,
  discount_id TEXT,
  plan_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rating_events_usage_event_id
  ON public.rating_events(usage_event_id);
CREATE INDEX IF NOT EXISTS rating_events_pricing_version
  ON public.rating_events(pricing_version_id);

ALTER TABLE public.rating_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rating_events_deny_anon ON public.rating_events;
CREATE POLICY rating_events_deny_anon
  ON public.rating_events FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rating_events_deny_authenticated ON public.rating_events;
CREATE POLICY rating_events_deny_authenticated
  ON public.rating_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 7. pricing_catalog — versioned pricing entries
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pricing_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_version_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  capability TEXT NOT NULL,
  unit TEXT NOT NULL,
  provider_rate_micros BIGINT NOT NULL,
  customer_rate_micros BIGINT NOT NULL,
  billing_class TEXT NOT NULL DEFAULT 'standard',
  minimum_bits INTEGER NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_catalog_version
  ON public.pricing_catalog(pricing_version_id);
CREATE INDEX IF NOT EXISTS pricing_catalog_provider_model
  ON public.pricing_catalog(provider, model);
CREATE INDEX IF NOT EXISTS pricing_catalog_capability
  ON public.pricing_catalog(capability);

ALTER TABLE public.pricing_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_catalog_deny_anon ON public.pricing_catalog;
CREATE POLICY pricing_catalog_deny_anon
  ON public.pricing_catalog FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS pricing_catalog_deny_authenticated ON public.pricing_catalog;
CREATE POLICY pricing_catalog_deny_authenticated
  ON public.pricing_catalog FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. pricing_versions — immutable pricing version registry
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pricing_versions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  exchange_rate_version_id TEXT NOT NULL,
  default_margin_bps INTEGER NOT NULL DEFAULT 5000,
  default_infra_allowance_micros BIGINT NOT NULL DEFAULT 10000,
  default_risk_reserve_bps INTEGER NOT NULL DEFAULT 1000,
  default_payment_allocation_bps INTEGER NOT NULL DEFAULT 300,
  approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_versions_deny_anon ON public.pricing_versions;
CREATE POLICY pricing_versions_deny_anon
  ON public.pricing_versions FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS pricing_versions_deny_authenticated ON public.pricing_versions;
CREATE POLICY pricing_versions_deny_authenticated
  ON public.pricing_versions FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 9. exchange_rate_versions — immutable exchange rate registry
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.exchange_rate_versions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  bits_per_usd_micro_num INTEGER NOT NULL,
  bits_per_usd_micro_den INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rate_den_positive CHECK (bits_per_usd_micro_den > 0),
  CONSTRAINT exchange_rate_num_positive CHECK (bits_per_usd_micro_num > 0)
);

ALTER TABLE public.exchange_rate_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exchange_rate_versions_deny_anon ON public.exchange_rate_versions;
CREATE POLICY exchange_rate_versions_deny_anon
  ON public.exchange_rate_versions FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS exchange_rate_versions_deny_authenticated ON public.exchange_rate_versions;
CREATE POLICY exchange_rate_versions_deny_authenticated
  ON public.exchange_rate_versions FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 10. spend_controls — server-enforced budget limits
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.spend_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN (
    'per_request', 'daily', 'monthly', 'per_agent',
    'organization', 'project', 'api_key', 'per_model', 'automation'
  )),
  max_bits INTEGER NOT NULL CHECK (max_bits > 0),
  enforcement TEXT NOT NULL DEFAULT 'hard_stop' CHECK (enforcement IN (
    'hard_stop', 'soft_warning', 'auto_topup'
  )),
  window_seconds INTEGER,
  agent_id TEXT,
  model TEXT,
  project_id UUID,
  api_key_id UUID,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spend_controls_user_active
  ON public.spend_controls(user_id) WHERE active = true;

ALTER TABLE public.spend_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spend_controls_deny_anon ON public.spend_controls;
CREATE POLICY spend_controls_deny_anon
  ON public.spend_controls FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS spend_controls_deny_authenticated ON public.spend_controls;
CREATE POLICY spend_controls_deny_authenticated
  ON public.spend_controls FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════
-- 11. Canonical reservation RPCs (NEW — alongside existing RPCs)
-- ═══════════════════════════════════════════════════════════════════════

-- reserve_bits: atomically reserve BITS for a pending execution.
-- Creates a RESERVE ledger entry and a credit_reservations row.
-- Returns FAILED if insufficient available balance.

-- NOTE: These RPCs are defined here as PROPOSED. They should be
-- implemented in a separate migration after the schema is applied.
-- The existing reserve_credits/refund_credits RPCs (which mutate
-- users.credits) remain until migration is complete.

-- ═══════════════════════════════════════════════════════════════════════
-- 12. NOT MIGRATED (intentional)
-- ═══════════════════════════════════════════════════════════════════════

-- The following are NOT changed by this migration:
--   - users.credits column (if it exists) — left as-is
--   - wallets table — left as-is (legacy)
--   - transactions table — left as-is (legacy)
--   - adjust_wallet_balance RPC — left as-is (legacy)
--   - reserve_credits RPC — left as-is (legacy, broken)
--   - refund_credits RPC — left as-is (legacy, broken)
--   - charge_credits RPC — left as-is (legacy, broken)
--   - grant_credits RPC — left as-is (canonical, extended)
--   - debit_credits RPC — left as-is (canonical, extended)
--   - get_user_balances RPC — left as-is (canonical)
--   - llm_usage_records table — left as-is (will be superseded by usage_events)
--   - generation_jobs table — left as-is (will be superseded by usage_events)
--   - agent_runs table — left as-is (will be extended)
--   - terminal_usage table — left as-is (will be superseded by usage_events)
