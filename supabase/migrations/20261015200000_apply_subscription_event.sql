-- Apply one Stripe subscription event under a per-user lock.
--
-- The webhook used to read the row, decide, then upsert. Two deliveries
-- could both see "no subscription" and the second write replaced the first.
-- This function holds pg_advisory_xact_lock(hashtext(user_id)) and
-- SELECT ... FOR UPDATE, then inserts with ON CONFLICT (user_id) when the
-- row is missing. It writes the event only when the locked row has no
-- subscription id, the same id, or a non-protected status
-- (canceled / incomplete_expired). Any other held id is inserted into
-- billing_subscription_conflicts and the function returns 'conflict'.
-- The webhook turns that into HTTP 500. It never acknowledges a conflict.
--
-- Credit grants and last_stripe_event_created move in the same transaction.
-- A grant error rolls the plan write back. A strictly older subscription
-- event returns 'stale' and writes nothing. Equal event seconds return
-- 'recheck' unless p_authoritative is true, so the webhook can re-read
-- Stripe before it writes.
--
-- invoice.paid uses ordering 'apply' with p_update_plan false. That call
-- grants and may refresh status, but it does not move
-- last_stripe_event_created. A customer.subscription.updated with an
-- earlier Stripe second can still change the plan after the invoice
-- lands. Deleted and payment_failed events use skip_if_older and still
-- move the clock, so a newer cancellation is not revived by an older
-- invoice. A conflict insert that fails rolls the function back.
--
-- The partial unique index is the backstop: one protected subscription
-- row per user. user_id is already unique; the index states the rule in
-- the predicate the function uses. Do not apply this file to a hosted
-- database from automation. Deploy it before the webhook that calls it.
--
-- Rollback, after that webhook code is reverted:
--   DROP FUNCTION IF EXISTS public.apply_subscription_event(uuid, text, text, text, bigint, boolean, text, boolean, text, text, boolean, text, text, text, timestamptz, timestamptz, boolean, text, text, integer, text, text, text, timestamptz, text, jsonb);
--   DROP INDEX IF EXISTS public.subscriptions_one_protected_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_protected_per_user
  ON public.subscriptions (user_id)
  WHERE stripe_subscription_id IS NOT NULL
    AND stripe_subscription_id <> ''
    AND status IS NOT NULL
    AND status NOT IN ('canceled', 'incomplete_expired');

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

  IF p_grant_mode = 'upgrade_delta' AND p_event_type = 'customer.subscription.updated' AND NOT v_inserted THEN
    v_prev := COALESCE((p_allowances ->> v_before.plan)::integer, 0);
    v_next := COALESCE((p_allowances ->> p_plan)::integer, 0);
    IF NOT v_period_rolled
      AND v_prev > 0
      AND v_next > v_prev
      AND p_grant_reference_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.credit_ledger
        WHERE user_id = p_user_id AND reference_id = p_grant_reference_id
      ) THEN
      v_delta := v_next - v_prev;
      SELECT g.granted INTO v_granted
      FROM public.grant_credits(
        p_user_id,
        v_delta,
        'subscription_grant',
        'monthly',
        'Plan upgrade to ' || p_plan || ' — ' || v_delta::text || ' LiTTBits',
        p_grant_idempotency_key,
        'subscription',
        p_grant_reference_id,
        NULL
      ) AS g;
    END IF;
  ELSIF p_grant_mode = 'invoice_full' THEN
    IF p_skip_grant_idempotency_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.credit_ledger
      WHERE user_id = p_user_id AND idempotency_key = p_skip_grant_idempotency_key
    ) THEN
      v_allowance := COALESCE((p_allowances ->> v_plan_for_grant)::integer, 0);
      IF p_grant_amount IS DISTINCT FROM v_allowance THEN
        RAISE EXCEPTION 'invoice grant amount % does not match allowance % for plan %',
          p_grant_amount, v_allowance, v_plan_for_grant;
      END IF;
      IF v_allowance > 0 THEN
        SELECT g.granted INTO v_granted
        FROM public.grant_credits(
          p_user_id,
          v_allowance,
          'subscription_grant',
          'monthly',
          p_grant_description,
          p_grant_idempotency_key,
          'subscription',
          p_grant_reference_id,
          p_grant_expires_at
        ) AS g;
      END IF;
    END IF;
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
