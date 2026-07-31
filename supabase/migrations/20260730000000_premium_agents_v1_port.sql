-- Premium Agents V1 Port — secure purchase and entitlement foundation
--
-- Adapted from feat/premium-agents-v1-rebuild with the following corrections:
--
--   A. Preserves ALL existing marketplace_items.item_type values and adds 'agent'.
--      Does NOT introduce 'capability' or remove existing types.
--   B. Agent installation uses user_agents (not marketplace_installations).
--      marketplace_installations remains for skills, tools, workflows, integrations.
--   C. Does NOT insert internal UUIDs into legacy TEXT user_id columns.
--      Adds new internal_user_id UUID columns to legacy tables for gradual migration.
--   D. Agent-level entitlements (UNIQUE(user_id, agent_id)), not version-level.
--      A purchase includes all compatible updates for the same major version.
--   E. fulfill_agent_purchase() and refund_agent_purchase() adapted to the
--      agent-level entitlement model — they cannot be ported unchanged.
--   F. Atomic Stripe event claim via INSERT ... ON CONFLICT DO NOTHING RETURNING
--      at the BEGINNING of each RPC.
--   G. RPC loads the authoritative agent version from the database — does not
--      trust webhook metadata for slug, price, or version status.
--   H. RPC verifies session.amount_total and session.currency against the stored
--      version price and currency. Mismatch raises an exception (HTTP 500 → retry).
--   I. Published versions are immutable — a trigger blocks UPDATE and DELETE.
--   J. No Stripe Price IDs are stored in this migration. Use attach_stripe_prices.sql
--      to set environment-specific Price IDs after creating Stripe products.
--
-- Phase 1 scope: purchase foundation only. No runtime, execution, or LBC changes.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Add columns to existing agents table
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS features TEXT[] DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. agent_versions: immutable published snapshots
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agent_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  -- Snapshot fields copied at publish time — the version is immutable once published.
  system_prompt TEXT NOT NULL,
  personality TEXT,
  model TEXT,
  features TEXT[] DEFAULT '{}',
  -- Pricing: stripe_price_id is the authoritative Stripe Price for checkout.
  -- price_cents is the expected amount for verification (must match Stripe).
  stripe_price_id TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  -- Lifecycle: draft → published → suspended → deprecated
  -- Only 'published' versions are purchasable. 'suspended' blocks new purchases
  -- but preserves existing entitlements. 'deprecated' is terminal.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'suspended', 'deprecated')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON public.agent_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_versions_status ON public.agent_versions(status);

ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_agent_versions ON public.agent_versions;
CREATE POLICY service_role_all_agent_versions ON public.agent_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Immutability trigger: block UPDATE and DELETE on published versions ──
-- A published version's pricing, system_prompt, and identity are frozen.
-- Only status transitions (published → suspended → deprecated) and updated_at
-- are allowed. All other column changes are rejected.

CREATE OR REPLACE FUNCTION public.enforce_agent_version_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'suspended', 'deprecated') THEN
      RAISE EXCEPTION 'Cannot delete agent_version %: published versions are immutable (status=%)',
        OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('published', 'suspended', 'deprecated') THEN
      -- Allow only status transitions and updated_at.
      IF NEW.system_prompt IS DISTINCT FROM OLD.system_prompt
         OR NEW.personality IS DISTINCT FROM OLD.personality
         OR NEW.model IS DISTINCT FROM OLD.model
         OR NEW.features IS DISTINCT FROM OLD.features
         OR NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
         OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
         OR NEW.currency IS DISTINCT FROM OLD.currency
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
         OR NEW.published_at IS DISTINCT FROM OLD.published_at
      THEN
        RAISE EXCEPTION 'Cannot modify immutable fields of published agent_version % (status=%). Only status transitions are allowed.',
          OLD.id, OLD.status;
      END IF;
      -- Validate status transition direction (no re-publishing).
      IF NEW.status = 'draft' AND OLD.status != 'draft' THEN
        RAISE EXCEPTION 'Cannot revert published agent_version % back to draft.',
          OLD.id;
      END IF;
      IF NEW.status = 'published' AND OLD.status != 'draft' THEN
        RAISE EXCEPTION 'Cannot re-publish agent_version % (was %). Create a new version instead.',
          OLD.id, OLD.status;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_version_immutability ON public.agent_versions;
CREATE TRIGGER trg_agent_version_immutability
  BEFORE UPDATE OR DELETE ON public.agent_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agent_version_immutability();

REVOKE ALL ON FUNCTION public.enforce_agent_version_immutability() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_agent_version_immutability() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. marketplace_orders: financial purchase records
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'partially_refunded',
                      'disputed', 'canceled', 'expired')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  -- Stripe identifiers (populated as they become available)
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  -- Order lifecycle
  expires_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  dispute_status TEXT
    CHECK (dispute_status IS NULL OR dispute_status IN ('open', 'won', 'lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_user ON public.marketplace_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON public.marketplace_orders(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_session ON public.marketplace_orders(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_payment_intent ON public.marketplace_orders(stripe_payment_intent_id);

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_marketplace_orders ON public.marketplace_orders;
CREATE POLICY service_role_all_marketplace_orders ON public.marketplace_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. marketplace_order_items: exact items purchased
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  agent_version_id UUID NOT NULL REFERENCES public.agent_versions(id),
  agent_slug TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, agent_version_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_order ON public.marketplace_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_version ON public.marketplace_order_items(agent_version_id);

ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_marketplace_order_items ON public.marketplace_order_items;
CREATE POLICY service_role_all_marketplace_order_items ON public.marketplace_order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. agent_entitlements: agent-level ownership rights
-- ═══════════════════════════════════════════════════════════════════════
--
-- Entitlements are at the AGENT level, not the version level.
-- A one-time purchase includes all compatible updates for the same major version.
-- UNIQUE(user_id, agent_id) prevents duplicate entitlements per agent.

CREATE TABLE IF NOT EXISTS public.agent_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- The version the user originally purchased
  purchased_version_id UUID NOT NULL REFERENCES public.agent_versions(id),
  -- Version policy: which updates are included
  includes_future_updates BOOLEAN NOT NULL DEFAULT true,
  minimum_version TEXT NOT NULL DEFAULT '1.0.0',
  maximum_version TEXT,
  -- Lifecycle
  order_id UUID NOT NULL REFERENCES public.marketplace_orders(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'suspended', 'refunded')),
  revoked_reason TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_entitlements_user ON public.agent_entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_entitlements_agent ON public.agent_entitlements(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_entitlements_status ON public.agent_entitlements(status);

ALTER TABLE public.agent_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_agent_entitlements ON public.agent_entitlements;
CREATE POLICY service_role_all_agent_entitlements ON public.agent_entitlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Add 'agent' to marketplace_items.item_type
-- ═══════════════════════════════════════════════════════════════════════
--
-- Preserves ALL existing item types. Does NOT introduce 'capability'.
-- Existing types: skill, tool, workflow, template, integration, creative_pack
-- Added: agent

ALTER TABLE public.marketplace_items
  DROP CONSTRAINT IF EXISTS marketplace_items_item_type_check;
ALTER TABLE public.marketplace_items
  ADD CONSTRAINT marketplace_items_item_type_check
  CHECK (item_type IN (
    'skill', 'tool', 'workflow', 'template', 'integration', 'creative_pack', 'agent'
  ));

-- Add agent-related columns to marketplace_items for agent listings
ALTER TABLE public.marketplace_items
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_version_id UUID REFERENCES public.agent_versions(id),
  ADD COLUMN IF NOT EXISTS billing_model TEXT DEFAULT 'free'
    CHECK (billing_model IN ('free', 'one_time', 'subscription')),
  ADD COLUMN IF NOT EXISTS included_plan_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Add internal_user_id to legacy tables (gradual migration)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Do NOT insert UUIDs into the existing TEXT user_id columns.
-- Add new UUID columns, backfill safely, migrate code, then remove legacy
-- columns in a later migration.

ALTER TABLE public.marketplace_installations
  ADD COLUMN IF NOT EXISTS internal_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_marketplace_installations_internal_user
  ON public.marketplace_installations(internal_user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. updated_at triggers
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_orders_updated_at ON public.marketplace_orders;
CREATE TRIGGER trg_marketplace_orders_updated_at
  BEFORE UPDATE ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_agent_entitlements_updated_at ON public.agent_entitlements;
CREATE TRIGGER trg_agent_entitlements_updated_at
  BEFORE UPDATE ON public.agent_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_agent_versions_updated_at ON public.agent_versions;
CREATE TRIGGER trg_agent_versions_updated_at
  BEFORE UPDATE ON public.agent_versions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 9. RPC: fulfill_agent_purchase — transactional webhook fulfillment
-- ═══════════════════════════════════════════════════════════════════════
--
-- Adapted from the rebuild branch for agent-level entitlements.
-- The webhook calls this RPC after receiving checkout.session.completed.
-- The RPC:
--   1. Atomically claims the Stripe event (INSERT ... ON CONFLICT DO NOTHING).
--   2. Loads the user by clerk_id from the database.
--   3. Loads the authoritative agent version from the database.
--   4. Locks the exact pending order created at checkout time (by order ID).
--   5. Verifies the order belongs to the resolved user and is still pending.
--   6. Verifies the paid amount and currency against the stored version price.
--   7. Attaches the Checkout Session ID and PaymentIntent ID to the order.
--   8. Marks the exact order as 'paid'.
--   9. Creates the order item (UNIQUE prevents duplicates).
--  10. Creates the agent-level entitlement (UNIQUE(user_id, agent_id) prevents dups).
--  11. Returns {"status":"ok"} or {"status":"already_processed"}.
--
-- On any failure, raises a PostgreSQL exception so the webhook returns 500
-- and Stripe retries. This prevents orphan pending orders and duplicate paid
-- orders.

CREATE OR REPLACE FUNCTION public.fulfill_agent_purchase(
  p_stripe_event_id TEXT,
  p_stripe_event_type TEXT,
  p_clerk_id TEXT,
  p_agent_id UUID,
  p_agent_version_id UUID,
  p_marketplace_order_id UUID,
  p_stripe_session_id TEXT,
  p_stripe_payment_intent_id TEXT,
  p_stripe_charge_id TEXT,
  p_amount_cents INTEGER,
  p_currency TEXT DEFAULT 'usd'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_order_id UUID;
  v_order RECORD;
  v_version RECORD;
  v_event_inserted BOOLEAN;
BEGIN
  -- 1. Atomically claim the Stripe event at the very beginning.
  INSERT INTO public.stripe_events (stripe_event_id, event_type, result)
  VALUES (p_stripe_event_id, p_stripe_event_type, 'fulfill_agent_purchase')
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING true AS inserted INTO v_event_inserted;

  IF NOT v_event_inserted THEN
    RETURN jsonb_build_object('status', 'already_processed');
  END IF;

  -- 2. Look up user by clerk_id.
  SELECT id INTO v_user_id FROM public.users WHERE clerk_id = p_clerk_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user_not_found: clerk_id=%', p_clerk_id;
  END IF;

  -- 3. Load the authoritative agent version from the database.
  SELECT
    av.id, av.agent_id, av.version, av.price_cents, av.currency, av.status,
    a.slug AS agent_slug
  INTO v_version
  FROM public.agent_versions av
  JOIN public.agents a ON a.id = av.agent_id
  WHERE av.id = p_agent_version_id AND av.agent_id = p_agent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_version_not_found: agent_id=%, version_id=%', p_agent_id, p_agent_version_id;
  END IF;

  IF v_version.status != 'published' THEN
    RAISE EXCEPTION 'agent_version_not_purchasable: status=%', v_version.status;
  END IF;

  -- 4. Lock and verify the exact pending order created at checkout time.
  -- This prevents orphan pending orders and duplicate paid orders.
  -- FOR UPDATE locks the row so concurrent webhook deliveries cannot race.
  SELECT id, user_id, status, total_cents, currency, stripe_checkout_session_id
  INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_marketplace_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found: order_id=%', p_marketplace_order_id;
  END IF;

  -- Verify the order belongs to the resolved user.
  IF v_order.user_id != v_user_id THEN
    RAISE EXCEPTION 'order_user_mismatch: order belongs to %, webhook clerk_id resolves to %',
      v_order.user_id, v_user_id;
  END IF;

  -- Verify the order is still pending (not already paid, failed, or expired).
  IF v_order.status != 'pending' THEN
    -- If already paid, this is a duplicate webhook — return ok.
    IF v_order.status = 'paid' THEN
      RETURN jsonb_build_object('status', 'already_processed', 'order_id', v_order.id);
    END IF;
    RAISE EXCEPTION 'order_not_pending: status=%', v_order.status;
  END IF;

  -- 5. Verify the paid amount and currency against the stored version price
  --    AND the order's expected total.
  IF p_amount_cents != v_version.price_cents THEN
    RAISE EXCEPTION 'amount_mismatch: paid=%, expected=%', p_amount_cents, v_version.price_cents;
  END IF;

  IF p_amount_cents != v_order.total_cents THEN
    RAISE EXCEPTION 'order_amount_mismatch: paid=%, order_total=%', p_amount_cents, v_order.total_cents;
  END IF;

  IF lower(p_currency) != lower(v_version.currency) THEN
    RAISE EXCEPTION 'currency_mismatch: paid=%, expected=%', p_currency, v_version.currency;
  END IF;

  -- 6. Verify the Checkout Session ID is not already assigned to another order.
  IF p_stripe_session_id IS NOT NULL THEN
    IF v_order.stripe_checkout_session_id IS NOT NULL AND v_order.stripe_checkout_session_id != p_stripe_session_id THEN
      RAISE EXCEPTION 'session_id_mismatch: order has %, webhook sends %',
        v_order.stripe_checkout_session_id, p_stripe_session_id;
    END IF;
  END IF;

  -- 7. Mark the exact order as paid and attach Stripe identifiers.
  UPDATE public.marketplace_orders
  SET
    status = 'paid',
    stripe_checkout_session_id = p_stripe_session_id,
    stripe_payment_intent_id = p_stripe_payment_intent_id,
    stripe_charge_id = p_stripe_charge_id,
    total_cents = p_amount_cents,
    currency = lower(p_currency),
    updated_at = now()
  WHERE id = v_order.id
  RETURNING id INTO v_order_id;

  -- 8. Create the order item (UNIQUE(order_id, agent_version_id) prevents duplicates).
  INSERT INTO public.marketplace_order_items (order_id, agent_version_id, agent_slug, price_cents, currency)
  VALUES (v_order_id, v_version.id, v_version.agent_slug, v_version.price_cents, v_version.currency)
  ON CONFLICT (order_id, agent_version_id) DO NOTHING;

  -- 9. Create the agent-level entitlement (UNIQUE(user_id, agent_id) prevents dups).
  -- V1 policy: includes_future_updates = true, maximum_version = same major version.
  INSERT INTO public.agent_entitlements (
    user_id, agent_id, purchased_version_id,
    includes_future_updates, minimum_version, maximum_version,
    order_id, status
  )
  VALUES (
    v_user_id,
    p_agent_id,
    v_version.id,
    true,
    v_version.version,
    substring(v_version.version from '^[0-9]+') || '.999.999',
    v_order_id,
    'active'
  )
  ON CONFLICT (user_id, agent_id) DO UPDATE
    SET
      status = 'active',
      revoked_reason = NULL,
      revoked_at = NULL,
      purchased_version_id = EXCLUDED.purchased_version_id,
      includes_future_updates = EXCLUDED.includes_future_updates,
      minimum_version = EXCLUDED.minimum_version,
      maximum_version = EXCLUDED.maximum_version,
      order_id = EXCLUDED.order_id,
      updated_at = now();

  RETURN jsonb_build_object('status', 'ok', 'order_id', v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_agent_purchase(
  TEXT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_agent_purchase(
  TEXT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. RPC: refund_agent_purchase — transactional refund processing
-- ═══════════════════════════════════════════════════════════════════════
--
-- Called when charge.refunded is received for an agent purchase.
-- This RPC does NOT debit LBC — agent purchases are not coin packs.
-- It only:
--   1. Atomically claims the Stripe event.
--   2. Finds the order by payment intent ID (primary lookup method).
--   3. Marks the order as refunded.
--   4. Revokes the entitlement.
--   5. Returns {"status":"ok"} or {"status":"already_processed"}.

CREATE OR REPLACE FUNCTION public.refund_agent_purchase(
  p_stripe_event_id TEXT,
  p_stripe_event_type TEXT,
  p_stripe_payment_intent_id TEXT,
  p_stripe_refund_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_event_inserted BOOLEAN;
BEGIN
  -- 1. Atomically claim the Stripe event.
  INSERT INTO public.stripe_events (stripe_event_id, event_type, result)
  VALUES (p_stripe_event_id, p_stripe_event_type, 'refund_agent_purchase')
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING true AS inserted INTO v_event_inserted;

  IF NOT v_event_inserted THEN
    RETURN jsonb_build_object('status', 'already_processed');
  END IF;

  -- 2. Find the order by payment intent (primary lookup — does not trust metadata).
  SELECT id INTO v_order_id FROM public.marketplace_orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;

  IF v_order_id IS NULL THEN
    -- Not an agent purchase — this is expected for coin pack / plan refunds.
    -- Return ok so the webhook acknowledges the event; the coin-pack handler
    -- runs separately based on product_type metadata.
    RETURN jsonb_build_object('status', 'ok', 'order_id', null);
  END IF;

  -- 3. Mark the order refunded and store the refund ID.
  UPDATE public.marketplace_orders
  SET
    status = 'refunded',
    stripe_refund_id = p_stripe_refund_id,
    updated_at = now()
  WHERE id = v_order_id;

  -- 4. Revoke the entitlement (retain the record for audit).
  UPDATE public.agent_entitlements
  SET
    status = 'refunded',
    revoked_reason = 'charge.refunded',
    revoked_at = now(),
    updated_at = now()
  WHERE order_id = v_order_id;

  RETURN jsonb_build_object('status', 'ok', 'order_id', v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.refund_agent_purchase(
  TEXT, TEXT, TEXT, TEXT
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_agent_purchase(
  TEXT, TEXT, TEXT, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. RPC: expire_pending_order — mark expired checkout sessions
-- ═══════════════════════════════════════════════════════════════════════
--
-- Called by a cron job or admin endpoint to mark pending orders as expired
-- when their Stripe Checkout session has expired (typically 24 hours).

CREATE OR REPLACE FUNCTION public.expire_pending_order(
  p_order_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.marketplace_orders
  SET status = 'expired', updated_at = now()
  WHERE id = p_order_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_pending');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_pending_order(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_order(UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 12. Seed premium agents and their published versions
-- ═══════════════════════════════════════════════════════════════════════

-- Seed 3 premium agents (no Stripe Price IDs — set via attach_stripe_prices.sql)
INSERT INTO public.agents (slug, display_name, description, role, is_core, is_public, is_featured, price_cents, features, system_prompt, personality)
VALUES
  (
    'litt-growth',
    'LiTT Growth',
    'SEO audit, IndexNow submission, content strategy, and daily growth actions.',
    'growth',
    false,
    true,
    true,
    1900,
    ARRAY['SEO audit', 'IndexNow submission', 'Content strategy', 'Growth recommendations'],
    'You are LiTT Growth, a specialized AI agent focused on SEO and growth. You help users audit their site, find ranking opportunities, generate targeted content, and submit URLs for indexing. You provide actionable growth recommendations based on real data.',
    'Analytical, data-driven, and growth-focused.'
  ),
  (
    'litt-social',
    'LiTT Social',
    'Social post generation, scheduling, brand voice, and content calendar management.',
    'social',
    false,
    true,
    true,
    1500,
    ARRAY['Social posts', 'Brand voice', 'Content calendar', 'Scheduling'],
    'You are LiTT Social, a specialized AI agent focused on social media content. You help users generate platform-specific posts, maintain brand voice consistency, plan content calendars, and schedule posts across channels.',
    'Creative, energetic, and brand-savvy.'
  ),
  (
    'litt-coder-pro',
    'LiTT Coder Pro',
    'Advanced code generation, refactoring, test writing, and deployment assistance.',
    'code',
    false,
    true,
    true,
    2900,
    ARRAY['Code generation', 'Refactoring', 'Test writing', 'Deployment'],
    'You are LiTT Coder Pro, a specialized AI agent focused on professional software development. You help users write production-quality code, refactor existing codebases, write comprehensive tests, and manage deployments. You follow best practices and provide detailed explanations.',
    'Precise, thorough, and production-focused.'
  )
  ON CONFLICT (slug) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    role = EXCLUDED.role,
    is_core = EXCLUDED.is_core,
    is_public = EXCLUDED.is_public,
    is_featured = EXCLUDED.is_featured,
    price_cents = EXCLUDED.price_cents,
    features = EXCLUDED.features,
    system_prompt = EXCLUDED.system_prompt,
    personality = EXCLUDED.personality,
    updated_at = now();

-- Seed immutable published versions (stripe_price_id = NULL until attached)
INSERT INTO public.agent_versions (agent_id, version, system_prompt, personality, model, features, stripe_price_id, price_cents, currency, status, published_at)
SELECT
  a.id,
  '1.0.0',
  a.system_prompt,
  a.personality,
  COALESCE(a.model, 'gpt-4o-mini'),
  a.features,
  NULL,
  a.price_cents,
  'usd',
  'published',
  now()
FROM public.agents a
WHERE a.slug IN ('litt-growth', 'litt-social', 'litt-coder-pro')
ON CONFLICT (agent_id, version) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 13. Seed marketplace_items entries for the 3 premium agents
-- ═══════════════════════════════════════════════════════════════════════
--
-- These create the marketplace listing for each agent. The agent_id and
-- agent_version_id connect the listing to the immutable published version.
-- billing_model = 'one_time' for V1 premium agents.

INSERT INTO public.marketplace_items (
  slug, name, description, item_type, category, status,
  compatible_assistants, capability_key, version, icon,
  is_featured, is_beta, required_connections,
  agent_id, agent_version_id, billing_model, risk_level, requires_approval
)
SELECT
  a.slug,
  a.display_name,
  a.description,
  'agent',
  a.role,
  'available',
  ARRAY['litt'],
  NULL,
  '1.0.0',
  NULL,
  true,
  false,
  '{}',
  a.id,
  av.id,
  'one_time',
  'medium',
  false
FROM public.agents a
JOIN public.agent_versions av ON av.agent_id = a.id AND av.version = '1.0.0'
WHERE a.slug IN ('litt-growth', 'litt-social', 'litt-coder-pro')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  item_type = EXCLUDED.item_type,
  category = EXCLUDED.category,
  agent_id = EXCLUDED.agent_id,
  agent_version_id = EXCLUDED.agent_version_id,
  billing_model = EXCLUDED.billing_model,
  risk_level = EXCLUDED.risk_level,
  requires_approval = EXCLUDED.requires_approval,
  updated_at = now();
