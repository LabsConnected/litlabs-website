-- Premium Agents V1 Phase 2 — schema and RPC fixes
--
-- This migration addresses blocking review defects found in Phase 2:
--
--   1. user_agents.agent_id: TEXT → UUID with FK to agents(id)
--      The existing /api/user-agents route already stores UUID strings
--      (cast to TEXT by Postgres). This makes the type explicit and adds
--      the foreign key that PostgREST needs for relational joins.
--
--   2. marketplace_order_items.agent_id: new UUID column with FK
--      Backfilled from agent_versions.agent_id.
--      Required for pending-order association before payment completes.
--
--   3. create_pending_agent_order() RPC: atomic order + order item creation
--      Called by the Checkout route BEFORE Stripe Checkout so the pending
--      state can be associated with the agent immediately.
--
--   4. fulfill_agent_purchase() updated: verifies the pre-existing order item
--      instead of creating it for the first time. The order item now carries
--      agent_id, which the RPC validates against the webhook metadata.
--
-- All changes are additive and backward-compatible with existing data.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Migrate user_agents.agent_id from TEXT to UUID
-- ═══════════════════════════════════════════════════════════════════════
--
-- The existing application code already stores UUID strings in this TEXT
-- column (see /api/user-agents POST handler). We:
--   a. Drop the duplicate unique constraint (user_agents_user_agent_unique)
--   b. Drop the original unique constraint (user_agents_user_id_agent_id_key)
--   c. Cast the column to UUID (invalid rows will fail — expected since
--      all production rows store UUID strings)
--   d. Add the FK to agents(id)
--   e. Recreate a single unique constraint

-- Drop duplicate unique constraint if it exists
ALTER TABLE public.user_agents
  DROP CONSTRAINT IF EXISTS user_agents_user_agent_unique;

-- Drop the original unique constraint
ALTER TABLE public.user_agents
  DROP CONSTRAINT IF EXISTS user_agents_user_id_agent_id_key;

-- Drop indexes that reference the TEXT column before altering
DROP INDEX IF EXISTS public.idx_user_agents_agent_id;

-- Cast agent_id to UUID. Any non-UUID values will cause an error, which
-- is correct — the application should only store UUIDs here.
ALTER TABLE public.user_agents
  ALTER COLUMN agent_id TYPE UUID USING agent_id::uuid;

-- Add FK to agents(id)
ALTER TABLE public.user_agents
  DROP CONSTRAINT IF EXISTS user_agents_agent_id_fkey;
ALTER TABLE public.user_agents
  ADD CONSTRAINT user_agents_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_user_agents_agent_id
  ON public.user_agents(agent_id);

-- Recreate a single unique constraint
ALTER TABLE public.user_agents
  DROP CONSTRAINT IF EXISTS user_agents_user_id_agent_id_key;

ALTER TABLE public.user_agents
  ADD CONSTRAINT user_agents_user_id_agent_id_key
  UNIQUE (user_id, agent_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Add agent_id UUID to marketplace_order_items
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.marketplace_order_items
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE;

-- Backfill agent_id from agent_versions for existing rows
UPDATE public.marketplace_order_items moi
  SET agent_id = av.agent_id
  FROM public.agent_versions av
  WHERE moi.agent_version_id = av.id
    AND moi.agent_id IS NULL;

-- Add index for pending-order lookups by agent_id
CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_agent
  ON public.marketplace_order_items(agent_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RPC: create_pending_agent_order — atomic order + order item
-- ═══════════════════════════════════════════════════════════════════════
--
-- Called by the Checkout route BEFORE creating the Stripe Checkout session.
-- Creates the pending order AND its order item in a single transaction so
-- the state endpoint can immediately associate the pending order with the
-- agent (via marketplace_order_items.agent_id).
--
-- Parameters:
--   p_user_id          — internal users.id UUID
--   p_agent_id         — agents.id UUID
--   p_agent_version_id — agent_versions.id UUID (the published version being purchased)
--   p_price_cents      — price from the immutable agent_versions row
--   p_currency         — currency from the immutable agent_versions row
--   p_expires_at       — order expiry (typically now + 24h)
--
-- Returns: {"order_id": "...", "order_item_id": "..."}

CREATE OR REPLACE FUNCTION public.create_pending_agent_order(
  p_user_id UUID,
  p_agent_id UUID,
  p_agent_version_id UUID,
  p_price_cents INTEGER,
  p_currency TEXT DEFAULT 'usd',
  p_expires_at TIMESTAMPTZ DEFAULT now() + interval '24 hours'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_order_item_id UUID;
  v_agent_slug TEXT;
BEGIN
  -- Validate the agent exists and is public
  PERFORM 1 FROM public.agents WHERE id = p_agent_id AND is_public = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_not_found_or_private: %', p_agent_id;
  END IF;

  -- Validate the version exists, belongs to this agent, and is published
  PERFORM 1 FROM public.agent_versions
  WHERE id = p_agent_version_id
    AND agent_id = p_agent_id
    AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_published: agent_id=%, version_id=%', p_agent_id, p_agent_version_id;
  END IF;

  -- Check for existing active entitlement (prevent duplicate checkout)
  PERFORM 1 FROM public.agent_entitlements
  WHERE user_id = p_user_id AND agent_id = p_agent_id AND status = 'active';
  IF FOUND THEN
    RAISE EXCEPTION 'already_entitled: user already owns this agent';
  END IF;

  -- Get the agent slug for the order item
  SELECT slug INTO v_agent_slug FROM public.agents WHERE id = p_agent_id;

  -- Create the pending order
  INSERT INTO public.marketplace_orders (user_id, status, total_cents, currency, expires_at)
  VALUES (p_user_id, 'pending', p_price_cents, p_currency, p_expires_at)
  RETURNING id INTO v_order_id;

  -- Create the pending order item (with agent_id for immediate association)
  INSERT INTO public.marketplace_order_items (order_id, agent_version_id, agent_id, agent_slug, price_cents, currency)
  VALUES (v_order_id, p_agent_version_id, p_agent_id, v_agent_slug, p_price_cents, p_currency)
  RETURNING id INTO v_order_item_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_item_id', v_order_item_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_agent_order(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_agent_order(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Update fulfill_agent_purchase: verify pre-existing order item
-- ═══════════════════════════════════════════════════════════════════════
--
-- The fulfillment RPC now verifies the pre-existing order item (created by
-- create_pending_agent_order) instead of creating it for the first time.
-- It validates that the order item's agent_id matches the webhook metadata.

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
  v_order_item RECORD;
  v_event_inserted BOOLEAN;
BEGIN
  -- 1. Atomically claim the Stripe event at the very beginning.
  INSERT INTO public.stripe_events (stripe_event_id, event_type, result)
  VALUES (p_stripe_event_id, p_stripe_event_type, 'fulfill_agent_purchase')
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING true AS inserted INTO v_event_inserted;

  IF v_event_inserted IS NOT TRUE THEN
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
    IF v_order.status = 'paid' THEN
      RETURN jsonb_build_object('status', 'already_processed', 'order_id', v_order.id);
    END IF;
    RAISE EXCEPTION 'order_not_pending: status=%', v_order.status;
  END IF;

  -- 5. Verify the pre-existing order item (created by create_pending_agent_order).
  --    The order item must exist and its agent_id must match the webhook metadata.
  SELECT id, agent_id, agent_version_id, price_cents
  INTO v_order_item
  FROM public.marketplace_order_items
  WHERE order_id = v_order.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_item_not_found: order_id=% — pending order item was not created at checkout',
      v_order.id;
  END IF;

  IF v_order_item.agent_id != p_agent_id THEN
    RAISE EXCEPTION 'order_item_agent_mismatch: order item has agent_id=%, webhook sends agent_id=%',
      v_order_item.agent_id, p_agent_id;
  END IF;

  IF v_order_item.agent_version_id != p_agent_version_id THEN
    RAISE EXCEPTION 'order_item_version_mismatch: order item has version_id=%, webhook sends version_id=%',
      v_order_item.agent_version_id, p_agent_version_id;
  END IF;

  -- 6. Verify the paid amount and currency against the stored version price
  --    AND the order's expected total AND the order item's price.
  IF p_amount_cents != v_version.price_cents THEN
    RAISE EXCEPTION 'amount_mismatch: paid=%, expected=%', p_amount_cents, v_version.price_cents;
  END IF;

  IF p_amount_cents != v_order.total_cents THEN
    RAISE EXCEPTION 'order_amount_mismatch: paid=%, order_total=%', p_amount_cents, v_order.total_cents;
  END IF;

  IF p_amount_cents != v_order_item.price_cents THEN
    RAISE EXCEPTION 'order_item_amount_mismatch: paid=%, item_price=%', p_amount_cents, v_order_item.price_cents;
  END IF;

  IF lower(p_currency) != lower(v_version.currency) THEN
    RAISE EXCEPTION 'currency_mismatch: paid=%, expected=%', p_currency, v_version.currency;
  END IF;

  -- 7. Verify the Checkout Session ID is not already assigned to another order.
  IF p_stripe_session_id IS NOT NULL THEN
    IF v_order.stripe_checkout_session_id IS NOT NULL AND v_order.stripe_checkout_session_id != p_stripe_session_id THEN
      RAISE EXCEPTION 'session_id_mismatch: order has %, webhook sends %',
        v_order.stripe_checkout_session_id, p_stripe_session_id;
    END IF;
  END IF;

  -- 8. Mark the exact order as paid and attach Stripe identifiers.
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
