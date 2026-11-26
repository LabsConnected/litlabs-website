-- Refuse Checkout while a protected subscription is still held.
--
-- apply_subscription_event will not replace a stripe_subscription_id whose
-- status is anything other than canceled or incomplete_expired. The previous
-- begin_checkout_reservation only blocked active, trialing, and past_due, so
-- unpaid, paused, incomplete, and refunded could open a second Stripe
-- subscription that the webhook then records as superseded.
--
-- This replaces the function from 20261015210000. Lease, reuse, and replace
-- behavior is unchanged. Apply after 20261015210000 and before the checkout
-- route that relies on the wider block. The route checks the same statuses
-- before it calls Stripe; this function is the lock-holding backstop.
--
-- Rollback, after the checkout route is reverted to the narrower list:
--   Restore begin_checkout_reservation from
--   20261015210000_checkout_session_lease.sql.

CREATE OR REPLACE FUNCTION public.begin_checkout_reservation(
  p_clerk_id text,
  p_user_id uuid,
  p_plan_id text,
  p_price_id text,
  p_now timestamptz,
  p_lease_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.checkout_reservations%ROWTYPE;
  token uuid;
  lease integer;
BEGIN
  IF p_clerk_id IS NULL OR length(trim(p_clerk_id)) < 1 THEN
    RAISE EXCEPTION 'clerk id is required';
  END IF;
  IF p_plan_id IS NULL OR p_price_id IS NULL THEN
    RAISE EXCEPTION 'plan and price are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('checkout:' || p_clerk_id, 0));

  IF p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = p_user_id
      AND status IN (
        'active',
        'trialing',
        'past_due',
        'unpaid',
        'paused',
        'incomplete',
        'refunded',
        'disputed'
      )
  ) THEN
    RETURN jsonb_build_object('action', 'already_subscribed');
  END IF;

  lease := GREATEST(COALESCE(p_lease_seconds, 60), 15);
  SELECT * INTO rec FROM public.checkout_reservations WHERE clerk_id = p_clerk_id FOR UPDATE;

  IF FOUND AND rec.expires_at > p_now THEN
    IF rec.status = 'open'
      AND rec.price_id = p_price_id
      AND rec.stripe_session_url IS NOT NULL
    THEN
      RETURN jsonb_build_object(
        'action', 'reuse',
        'url', rec.stripe_session_url,
        'session_id', rec.stripe_session_id,
        'plan_id', rec.plan_id
      );
    END IF;

    IF rec.status = 'open'
      AND rec.stripe_session_id IS NOT NULL
      AND rec.price_id IS DISTINCT FROM p_price_id
    THEN
      token := gen_random_uuid();
      UPDATE public.checkout_reservations SET
        user_id = p_user_id,
        plan_id = p_plan_id,
        price_id = p_price_id,
        stripe_session_id = NULL,
        stripe_session_url = NULL,
        status = 'pending',
        reservation_token = token,
        expires_at = p_now + make_interval(secs => lease),
        updated_at = p_now
      WHERE clerk_id = p_clerk_id;
      RETURN jsonb_build_object(
        'action', 'replace',
        'token', token,
        'expire_session_id', rec.stripe_session_id,
        'previous_url', rec.stripe_session_url,
        'previous_plan_id', rec.plan_id,
        'previous_price_id', rec.price_id,
        'previous_expires_at', rec.expires_at
      );
    END IF;

    RETURN jsonb_build_object(
      'action', 'in_progress',
      'plan_id', rec.plan_id,
      'price_id', rec.price_id
    );
  END IF;

  token := gen_random_uuid();
  INSERT INTO public.checkout_reservations (
    clerk_id, user_id, plan_id, price_id, stripe_session_id, stripe_session_url,
    status, reservation_token, expires_at, created_at, updated_at
  ) VALUES (
    p_clerk_id, p_user_id, p_plan_id, p_price_id, NULL, NULL,
    'pending', token, p_now + make_interval(secs => lease), p_now, p_now
  )
  ON CONFLICT (clerk_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    plan_id = EXCLUDED.plan_id,
    price_id = EXCLUDED.price_id,
    stripe_session_id = NULL,
    stripe_session_url = NULL,
    status = 'pending',
    reservation_token = EXCLUDED.reservation_token,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'action', 'create',
    'token', token,
    'expire_session_id', CASE WHEN FOUND THEN rec.stripe_session_id ELSE NULL END,
    'previous_url', CASE WHEN FOUND THEN rec.stripe_session_url ELSE NULL END,
    'previous_plan_id', CASE WHEN FOUND THEN rec.plan_id ELSE NULL END,
    'previous_price_id', CASE WHEN FOUND THEN rec.price_id ELSE NULL END,
    'previous_expires_at', CASE WHEN FOUND THEN rec.expires_at ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_checkout_reservation(text, uuid, text, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_checkout_reservation(text, uuid, text, text, timestamptz, integer)
  TO service_role;
