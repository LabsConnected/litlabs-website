-- Premium Agents V1: immutable agent versions, marketplace orders, entitlements
-- No Stripe Price IDs are stored in this migration. Use attach_stripe_prices.sql
-- to set environment-specific Price IDs after creating Stripe products.

-- ── agent_versions: immutable published snapshots ──
CREATE TABLE IF NOT EXISTS public.agent_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  personality TEXT,
  model TEXT,
  features TEXT[] DEFAULT '{}',
  stripe_price_id TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deprecated')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON public.agent_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_versions_status ON public.agent_versions(status);

ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_agent_versions ON public.agent_versions;
CREATE POLICY service_role_all_agent_versions ON public.agent_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── marketplace_orders: all currency in integer cents ──
CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_checkout_session_id TEXT UNIQUE NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_charge_id TEXT UNIQUE,
  stripe_refund_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_user ON public.marketplace_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON public.marketplace_orders(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_payment_intent ON public.marketplace_orders(stripe_payment_intent_id);

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_marketplace_orders ON public.marketplace_orders;
CREATE POLICY service_role_all_marketplace_orders ON public.marketplace_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── marketplace_order_items ──
CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  agent_version_id UUID NOT NULL REFERENCES public.agent_versions(id),
  agent_slug TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_order ON public.marketplace_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_version ON public.marketplace_order_items(agent_version_id);

ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_marketplace_order_items ON public.marketplace_order_items;
CREATE POLICY service_role_all_marketplace_order_items ON public.marketplace_order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── agent_entitlements: unique buyer + version ──
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

-- ── Seed 3 premium agents (no Stripe Price IDs) ──
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

-- ── Seed immutable agent versions (stripe_price_id = NULL) ──
INSERT INTO public.agent_versions (agent_id, version, system_prompt, personality, model, features, stripe_price_id, price_cents, status)
SELECT
  id,
  '1.0.0',
  system_prompt,
  personality,
  model,
  features,
  NULL,
  price_cents,
  'active'
FROM public.agents
WHERE slug IN ('litt-growth', 'litt-social', 'litt-coder-pro')
ON CONFLICT (agent_id, version) DO NOTHING;

-- ── Postgres RPC: transactional webhook fulfillment ──
CREATE OR REPLACE FUNCTION public.fulfill_agent_purchase(
  p_stripe_event_id TEXT,
  p_stripe_event_type TEXT,
  p_clerk_id TEXT,
  p_agent_version_id UUID,
  p_agent_slug TEXT,
  p_stripe_session_id TEXT,
  p_stripe_payment_intent_id TEXT,
  p_stripe_charge_id TEXT,
  p_amount_cents INTEGER,
  p_currency TEXT DEFAULT 'usd'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_order_id UUID;
  v_event_exists BOOLEAN;
BEGIN
  -- 1. Claim the Stripe event idempotently
  SELECT EXISTS(SELECT 1 FROM public.stripe_events WHERE stripe_event_id = p_stripe_event_id)
    INTO v_event_exists;
  IF v_event_exists THEN
    RETURN jsonb_build_object('status', 'already_processed');
  END IF;

  -- 2. Look up user by clerk_id
  SELECT id INTO v_user_id FROM public.users WHERE clerk_id = p_clerk_id;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'user_not_found');
  END IF;

  -- 3. Create or update order (status: paid)
  INSERT INTO public.marketplace_orders (
    user_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
    status, total_cents, currency
  ) VALUES (
    v_user_id, p_stripe_session_id, p_stripe_payment_intent_id, p_stripe_charge_id,
    'paid', p_amount_cents, p_currency
  )
  ON CONFLICT (stripe_checkout_session_id) DO UPDATE
    SET status = 'paid', updated_at = now()
  RETURNING id INTO v_order_id;

  -- 4. Create order item
  INSERT INTO public.marketplace_order_items (order_id, agent_version_id, agent_slug, price_cents)
  VALUES (v_order_id, p_agent_version_id, p_agent_slug, p_amount_cents)
  ON CONFLICT DO NOTHING;

  -- 5. Create entitlement (UNIQUE prevents duplicates)
  INSERT INTO public.agent_entitlements (user_id, agent_version_id, order_id, status)
  VALUES (v_user_id, p_agent_version_id, v_order_id, 'active')
  ON CONFLICT (user_id, agent_version_id) DO NOTHING;

  -- 6. Mark Stripe event processed
  INSERT INTO public.stripe_events (stripe_event_id, event_type, result)
  VALUES (p_stripe_event_id, p_stripe_event_type, 'fulfill_agent_purchase')
  ON CONFLICT (stripe_event_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'ok', 'order_id', v_order_id);
END;
$$;

-- ── Postgres RPC: transactional refund ──
CREATE OR REPLACE FUNCTION public.refund_agent_purchase(
  p_stripe_event_id TEXT,
  p_stripe_event_type TEXT,
  p_stripe_payment_intent_id TEXT,
  p_stripe_refund_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_event_exists BOOLEAN;
BEGIN
  -- 1. Idempotency check
  SELECT EXISTS(SELECT 1 FROM public.stripe_events WHERE stripe_event_id = p_stripe_event_id)
    INTO v_event_exists;
  IF v_event_exists THEN
    RETURN jsonb_build_object('status', 'already_processed');
  END IF;

  -- 2. Find order by payment intent
  SELECT id INTO v_order_id FROM public.marketplace_orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;
  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'order_not_found');
  END IF;

  -- 3. Mark order refunded, store refund ID
  UPDATE public.marketplace_orders
  SET status = 'refunded', stripe_refund_id = p_stripe_refund_id, updated_at = now()
  WHERE id = v_order_id;

  -- 4. Revoke entitlement (retain record)
  UPDATE public.agent_entitlements
  SET status = 'refunded', revoked_reason = 'charge.refunded', revoked_at = now(), updated_at = now()
  WHERE order_id = v_order_id;

  -- 5. Mark event processed
  INSERT INTO public.stripe_events (stripe_event_id, event_type, result)
  VALUES (p_stripe_event_id, p_stripe_event_type, 'refund_agent_purchase')
  ON CONFLICT (stripe_event_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'ok', 'order_id', v_order_id);
END;
$$;
