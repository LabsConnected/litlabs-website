-- Settled-invoice subscription credits.
--
-- Do NOT apply this file to any hosted database. It is a local and CI
-- migration until a human deploys it. It replaces apply_subscription_event
-- so a ledger credit is inserted only for invoice_full. upgrade_delta remains
-- a legal mode and inserts nothing: a plan change on customer.subscription.updated
-- cannot credit the wallet. Re-applying 20261015200000 restores the previous
-- body, including the upgrade_delta grant.
--
-- Rollback, after the webhook that depends on this body is reverted:
--   Re-apply supabase/migrations/20261015200000_apply_subscription_event.sql

CREATE OR REPLACE FUNCTION public.apply_subscription_event(
  p_user_id uuid,
  p_incoming_subscription_id text,
  p_stripe_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_authoritative boolean,
  p_ordering text,
  p_require_existing boolean,
  p_plan text,
  p_status text,
  p_update_plan boolean,
  p_status_policy text,
  p_live_status text,
  p_stripe_customer_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_incoming_plan text,
  p_grant_mode text,
  p_grant_amount integer,
  p_grant_idempotency_key text,
  p_grant_description text,
  p_grant_reference_id text,
  p_grant_expires_at timestamptz,
  p_skip_grant_idempotency_key text,
  p_allowances jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.subscriptions%ROWTYPE;
  v_before public.subscriptions%ROWTYPE;
  v_found boolean := false;
  v_inserted boolean := false;
  v_held text;
  v_status text;
  v_last bigint;
  v_updated integer := 0;
  v_plan_for_grant text;
  v_prev integer := 0;
  v_next integer := 0;
  v_allowance integer := 0;
  v_delta integer := 0;
  v_period_rolled boolean := false;
  v_granted boolean;
BEGIN
  IF p_user_id IS NULL OR p_incoming_subscription_id IS NULL OR length(btrim(p_incoming_subscription_id)) = 0 THEN
    RAISE EXCEPTION 'apply_subscription_event requires a user and subscription id';
  END IF;
  IF p_ordering NOT IN ('skip_if_older', 'apply') THEN
    RAISE EXCEPTION 'apply_subscription_event ordering % is not supported', p_ordering;
  END IF;
  IF p_status_policy NOT IN ('write', 'activate_unless_terminal', 'leave') THEN
    RAISE EXCEPTION 'apply_subscription_event status policy % is not supported', p_status_policy;
  END IF;
  IF p_grant_mode NOT IN ('none', 'upgrade_delta', 'invoice_full') THEN
    RAISE EXCEPTION 'apply_subscription_event grant mode % is not supported', p_grant_mode;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT * INTO v_row
  FROM public.subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    IF p_require_existing THEN
      RAISE EXCEPTION 'no subscription row for %', p_incoming_subscription_id;
    END IF;

    IF p_status_policy = 'write' THEN
      v_status := p_status;
    ELSIF p_status_policy = 'activate_unless_terminal'
      AND COALESCE(p_live_status, '') IN ('canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused') THEN
      v_status := COALESCE(p_status, 'incomplete');
    ELSIF p_status_policy = 'activate_unless_terminal' THEN
      v_status := 'active';
    ELSE
      v_status := p_status;
    END IF;

    INSERT INTO public.subscriptions (
      user_id,
      stripe_customer_id,
      stripe_subscription_id,
      plan,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      last_stripe_event_created,
      updated_at
    ) VALUES (
      p_user_id,
      p_stripe_customer_id,
      p_incoming_subscription_id,
      CASE WHEN p_update_plan THEN p_plan ELSE COALESCE(p_plan, 'free') END,
      v_status,
      p_period_start,
      p_period_end,
      p_cancel_at_period_end,
      CASE
        WHEN p_ordering = 'apply' AND NOT COALESCE(p_update_plan, false) THEN NULL
        ELSE p_event_created
      END,
      now()
    )
    ON CONFLICT (user_id) DO NOTHING;

    IF FOUND THEN
      v_inserted := true;
    END IF;

    SELECT * INTO v_row
    FROM public.subscriptions
    WHERE user_id = p_user_id
    FOR UPDATE;
    v_found := FOUND;
    IF NOT v_found THEN
      RAISE EXCEPTION 'apply_subscription_event could not lock the subscription row';
    END IF;
  END IF;

  IF v_inserted THEN
    v_plan_for_grant := p_plan;
  ELSE
    v_before := v_row;

    IF p_ordering = 'skip_if_older'
      AND v_row.last_stripe_event_created IS NOT NULL
      AND p_event_created < v_row.last_stripe_event_created THEN
      RETURN jsonb_build_object('outcome', 'stale');
    END IF;

    v_held := NULLIF(btrim(COALESCE(v_row.stripe_subscription_id, '')), '');
    IF v_held IS NOT NULL
      AND v_held IS DISTINCT FROM p_incoming_subscription_id
      AND COALESCE(v_row.status, '') NOT IN ('canceled', 'incomplete_expired') THEN
      INSERT INTO public.billing_subscription_conflicts (
        user_id,
        existing_subscription_id,
        incoming_subscription_id,
        stripe_event_id,
        event_type,
        incoming_plan
      ) VALUES (
        p_user_id,
        v_held,
        p_incoming_subscription_id,
        p_stripe_event_id,
        p_event_type,
        p_incoming_plan
      )
      ON CONFLICT (stripe_event_id, incoming_subscription_id) DO NOTHING;
      RETURN jsonb_build_object(
        'outcome', 'conflict',
        'existing_subscription_id', v_held
      );
    END IF;

    IF p_ordering = 'skip_if_older'
      AND v_row.last_stripe_event_created IS NOT NULL
      AND p_event_created = v_row.last_stripe_event_created
      AND NOT COALESCE(p_authoritative, false) THEN
      RETURN jsonb_build_object('outcome', 'recheck');
    END IF;

    IF p_status_policy = 'write' THEN
      v_status := p_status;
    ELSIF p_status_policy = 'activate_unless_terminal'
      AND v_row.last_stripe_event_created IS NOT NULL
      AND v_row.last_stripe_event_created > p_event_created
      AND COALESCE(v_row.status, '') IN ('canceled', 'past_due', 'unpaid', 'incomplete_expired', 'refunded') THEN
      v_status := v_row.status;
    ELSIF p_status_policy = 'activate_unless_terminal'
      AND COALESCE(p_live_status, '') IN ('canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused') THEN
      v_status := v_row.status;
    ELSIF p_status_policy = 'activate_unless_terminal' THEN
      v_status := 'active';
    ELSE
      v_status := v_row.status;
    END IF;

    v_last := CASE
      WHEN p_ordering = 'apply' AND NOT COALESCE(p_update_plan, false) THEN v_row.last_stripe_event_created
      WHEN v_row.last_stripe_event_created IS NULL OR p_event_created >= v_row.last_stripe_event_created
        THEN p_event_created
      ELSE v_row.last_stripe_event_created
    END;

    UPDATE public.subscriptions SET
      stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
      stripe_subscription_id = CASE
        WHEN p_update_plan THEN p_incoming_subscription_id
        ELSE stripe_subscription_id
      END,
      plan = CASE WHEN p_update_plan THEN p_plan ELSE plan END,
      status = v_status,
      current_period_start = COALESCE(p_period_start, current_period_start),
      current_period_end = COALESCE(p_period_end, current_period_end),
      cancel_at_period_end = CASE
        WHEN p_cancel_at_period_end IS NULL THEN cancel_at_period_end
        ELSE p_cancel_at_period_end
      END,
      last_stripe_event_created = v_last,
      updated_at = now()
    WHERE user_id = p_user_id
      AND (
        stripe_subscription_id IS NULL
        OR btrim(stripe_subscription_id) = ''
        OR stripe_subscription_id = p_incoming_subscription_id
        OR COALESCE(status, '') IN ('canceled', 'incomplete_expired')
      );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      v_held := NULLIF(btrim(COALESCE(v_before.stripe_subscription_id, '')), '');
      INSERT INTO public.billing_subscription_conflicts (
        user_id,
        existing_subscription_id,
        incoming_subscription_id,
        stripe_event_id,
        event_type,
        incoming_plan
      ) VALUES (
        p_user_id,
        COALESCE(v_held, ''),
        p_incoming_subscription_id,
        p_stripe_event_id,
        p_event_type,
        p_incoming_plan
      )
      ON CONFLICT (stripe_event_id, incoming_subscription_id) DO NOTHING;
      RETURN jsonb_build_object(
        'outcome', 'conflict',
        'existing_subscription_id', COALESCE(v_held, '')
      );
    END IF;

    v_plan_for_grant := CASE WHEN p_update_plan THEN p_plan ELSE v_before.plan END;
    v_period_rolled := v_before.current_period_end IS NOT NULL
      AND p_period_end IS NOT NULL
      AND v_before.current_period_end IS DISTINCT FROM p_period_end;
  END IF;

  -- Credits are inserted only for a settled invoice (p_grant_mode invoice_full).
  -- upgrade_delta is closed: customer.subscription.updated may still change
  -- the plan, and this branch writes no ledger row. The invoice amount is
  -- the caller's settled-invoice figure. It must be one configured allowance
  -- or the positive difference of two allowances. It is not read from the
  -- stored plan, and a previously written upgrade key does not skip it.
  IF p_grant_mode = 'invoice_full' THEN
    IF p_grant_idempotency_key IS NULL OR length(btrim(p_grant_idempotency_key)) < 8 THEN
      RAISE EXCEPTION 'invoice grant requires an idempotency key';
    END IF;
    IF COALESCE(p_grant_amount, 0) <= 0 THEN
      RAISE EXCEPTION 'invoice grant amount must be positive';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_each_text(COALESCE(p_allowances, '{}'::jsonb)) AS allowance(plan_id, amount)
      WHERE allowance.amount ~ '^[0-9]+$'
        AND allowance.amount::integer = p_grant_amount
    ) AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each_text(COALESCE(p_allowances, '{}'::jsonb)) AS hi(plan_id, amount)
      JOIN jsonb_each_text(COALESCE(p_allowances, '{}'::jsonb)) AS lo(plan_id, amount)
        ON hi.plan_id <> lo.plan_id
      WHERE hi.amount ~ '^[0-9]+$'
        AND lo.amount ~ '^[0-9]+$'
        AND lo.amount::integer > 0
        AND hi.amount::integer > lo.amount::integer
        AND (hi.amount::integer - lo.amount::integer) = p_grant_amount
    ) THEN
      RAISE EXCEPTION 'invoice grant amount % is not a settled plan allowance or upgrade delta', p_grant_amount;
    END IF;
    SELECT g.granted INTO v_granted
    FROM public.grant_credits(
      p_user_id,
      p_grant_amount,
      'subscription_grant',
      'monthly',
      COALESCE(p_grant_description, 'Settled invoice grant'),
      p_grant_idempotency_key,
      'subscription',
      COALESCE(p_grant_reference_id, p_grant_idempotency_key),
      p_grant_expires_at
    ) AS g;
  END IF;

  RETURN jsonb_build_object('outcome', 'applied');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_event(
  uuid, text, text, text, bigint, boolean, text, boolean, text, text, boolean, text, text, text, timestamptz, timestamptz, boolean, text, text, integer, text, text, text, timestamptz, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_event(
  uuid, text, text, text, bigint, boolean, text, boolean, text, text, boolean, text, text, text, timestamptz, timestamptz, boolean, text, text, integer, text, text, text, timestamptz, text, jsonb
) TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO service_role;
GRANT INSERT ON TABLE public.billing_subscription_conflicts TO service_role;
GRANT SELECT ON TABLE public.credit_ledger TO service_role;
