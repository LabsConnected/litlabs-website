-- Premium Agents V1: immutable agent versions, marketplace orders, entitlements
--
-- Corrections from the rescued WIP migration:
--   A. Atomic Stripe event claim via INSERT ... ON CONFLICT DO NOTHING RETURNING
--      at the BEGINNING of each RPC — no SELECT-then-INSERT race.
--   B. UNIQUE(order_id, agent_version_id) on marketplace_order_items.
--   C. RPC loads the authoritative agent version from the database — does not
--      trust webhook metadata for slug, price, or version status.
--   D. RPC verifies session.amount_total and session.currency against the stored
--      version price and currency. Mismatch raises an exception (HTTP 500 → retry).
--   E. Failures raise PostgreSQL exceptions so Supabase returns rpcError and the
--      webhook returns HTTP 500. Success returns {"status":"ok"} or
--      {"status":"already_processed"}.
--   F. Published versions are immutable — a trigger blocks UPDATE and DELETE.
--   G. Full Stripe identifier columns: checkout_session_id, payment_intent_id,
--      charge_id, refund_id.
--   H. Order statuses: pending, paid, failed, refunded, partially_refunded,
--      disputed, canceled.
--
-- No Stripe Price IDs are stored in this migration. Use attach_stripe_prices.sql
-- to set environment-specific Price IDs after creating Stripe products.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. agent_versions: immutable published snapshots
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
-- 2. marketplace_orders: all currency in integer cents
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'paid', 'failed', 'refunded',
      'partially_refunded', 'disputed', 'canceled'
    )),
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_user ON public.marketplace_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON public.marketplace_orders(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_payment_intent ON public.marketplace_orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_checkout_session ON public.marketplace_orders(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_marketplace_orders ON public.marketplace_orders;
CREATE POLICY service_role_all_marketplace_orders ON public.marketplace_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. marketplace_order_items: one row per agent version per order
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  agent_version_id UUID NOT NULL REFERENCES public.agent_versions(id),
  agent_slug TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Prevent duplicate items for the same order + version.
  UNIQUE(order_id, agent_version_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_order ON public.marketplace_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_version ON public.marketplace_order_items(agent_version_id);

ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_marketplace_order_items ON public.marketplace_order_items;
CREATE POLICY service_role_all_marketplace_order_items ON public.marketplace_order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. agent_entitlements: unique buyer + version
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agent_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_version_id UUID NOT NULL REFERENCES public.agent_versions(id),
  order_id UUID NOT NULL REFERENCES public.marketplace_orders(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'suspended', 'refunded')),
  revoked_reason TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_version_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_entitlements_user ON public.agent_entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_entitlements_status ON public.agent_entitlements(status);

ALTER TABLE public.agent_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_agent_entitlements ON public.agent_entitlements;
CREATE POLICY service_role_all_agent_entitlements ON public.agent_entitlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. updated_at triggers
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
-- 6. RPC: fulfill_agent_purchase — transactional webhook fulfillment
-- ═══════════════════════════════════════════════════════════════════════
--
-- The webhook calls this RPC after receiving checkout.session.completed.
-- The RPC:
--   1. Atomically claims the Stripe event (INSERT ... ON CONFLICT DO NOTHING).
--   2. Loads the user by clerk_id from the database.
--   3. Loads the authoritative agent version from the database — does NOT
--      trust webhook metadata for price, slug, or status.
--   4. Verifies the paid amount and currency against the stored version price.
--   5. Creates or updates the marketplace order to 'paid'.
--   6. Creates the order item (UNIQUE prevents duplicates).
--   7. Creates the entitlement (UNIQUE prevents duplicates).
--   8. Returns {"status":"ok"} or {"status":"already_processed"}.
--
-- On any failure, raises a PostgreSQL exception so the webhook returns 500
-- and Stripe retries.

CREATE OR REPLACE FUNCTION public.fulfill_agent_purchase(
  p_stripe_event_id TEXT,
  p_stripe_event_type TEXT,
  p_clerk_id TEXT,
  p_agent_version_id UUID,
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
  v_version RECORD;
  v_event_inserted BOOLEAN;
BEGIN
  -- 1. Atomically claim the Stripe event at the very beginning.
  -- If the event was already processed, return immediately.
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
  -- Do NOT trust webhook metadata for price, slug, or status.
  SELECT
    av.id, av.agent_id, av.version, av.price_cents, av.currency, av.status,
    a.slug AS agent_slug
  INTO v_version
  FROM public.agent_versions av
  JOIN public.agents a ON a.id = av.agent_id
  WHERE av.id = p_agent_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_version_not_found: %', p_agent_version_id;
  END IF;

  IF v_version.status != 'published' THEN
    RAISE EXCEPTION 'agent_version_not_purchasable: status=%', v_version.status;
  END IF;

  -- 4. Verify the paid amount and currency against the stored version price.
  IF p_amount_cents != v_version.price_cents THEN
    RAISE EXCEPTION 'amount_mismatch: paid=%, expected=%', p_amount_cents, v_version.price_cents;
  END IF;

  IF lower(p_currency) != lower(v_version.currency) THEN
    RAISE EXCEPTION 'currency_mismatch: paid=%, expected=%', p_currency, v_version.currency;
  END IF;

  -- 5. Create or update the marketplace order.
  INSERT INTO public.marketplace_orders (
    user_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
    status, total_cents, currency
  ) VALUES (
    v_user_id, p_stripe_session_id, p_stripe_payment_intent_id, p_stripe_charge_id,
    'paid', p_amount_cents, lower(p_currency)
  )
  ON CONFLICT (stripe_checkout_session_id) DO UPDATE
    SET
      status = 'paid',
      stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
      stripe_charge_id = EXCLUDED.stripe_charge_id,
      total_cents = EXCLUDED.total_cents,
      updated_at = now()
  RETURNING id INTO v_order_id;

  -- 6. Create the order item (UNIQUE(order_id, agent_version_id) prevents duplicates).
  INSERT INTO public.marketplace_order_items (order_id, agent_version_id, agent_slug, price_cents, currency)
  VALUES (v_order_id, v_version.id, v_version.agent_slug, v_version.price_cents, v_version.currency)
  ON CONFLICT (order_id, agent_version_id) DO NOTHING;

  -- 7. Create the entitlement (UNIQUE(user_id, agent_version_id) prevents duplicates).
  INSERT INTO public.agent_entitlements (user_id, agent_version_id, order_id, status)
  VALUES (v_user_id, v_version.id, v_order_id, 'active')
  ON CONFLICT (user_id, agent_version_id) DO UPDATE
    SET status = 'active', revoked_reason = NULL, revoked_at = NULL, updated_at = now();

  RETURN jsonb_build_object('status', 'ok', 'order_id', v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_agent_purchase(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_agent_purchase(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. RPC: refund_agent_purchase — transactional refund processing
-- ═══════════════════════════════════════════════════════════════════════
--
-- Called when charge.refunded is received for an agent purchase.
-- This RPC does NOT debit LBC — agent purchases are not coin packs.
-- It only:
--   1. Atomically claims the Stripe event.
--   2. Finds the order by payment intent ID.
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

  -- 2. Find the order by payment intent.
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
-- 8. Seed premium agents and their published versions
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
