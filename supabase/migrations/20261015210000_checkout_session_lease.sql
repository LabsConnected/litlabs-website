-- Checkout sessions expire about 30 minutes after creation. The reservation
-- lease has to cover that whole window, and a different plan replaces the
-- open session instead of blocking the customer until a 24 hour row dies.
--
-- begin_checkout_reservation:
--   same open price with a URL  -> reuse
--   open row for another price  -> replace (pending token, old session id
--                                  cleared before the expire webhook runs)
--   other unexpired row         -> in_progress
--   expired row that still has  -> create, plus expire_session_id so the
--   a Stripe session id           route can expire the orphan first
--
-- release_checkout_reservation deletes the row for a Checkout Session that
-- Stripe has expired, so the customer is not held after they leave.
-- restore_open_checkout_reservation puts the previous open row back when
-- the expire call fails and a new session must not be created.
--
-- Apply before the checkout route that expires the prior session. If
-- release_checkout_reservation is missing, checkout.session.expired returns
-- 500 and Stripe retries.
--
-- Rollback, after the checkout route no longer calls these functions:
--   DROP FUNCTION IF EXISTS public.release_checkout_reservation(text);
--   DROP FUNCTION IF EXISTS public.restore_open_checkout_reservation(text, uuid, text, text, text, text, timestamptz);
--   Restore begin_checkout_reservation from 20261015160000_checkout_reservations.sql.

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
      AND status IN ('active', 'trialing', 'past_due')
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

CREATE OR REPLACE FUNCTION public.restore_open_checkout_reservation(
  p_clerk_id text,
  p_token uuid,
  p_session_id text,
  p_url text,
  p_plan_id text,
  p_price_id text,
  p_open_until timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('checkout:' || p_clerk_id, 0));
  UPDATE public.checkout_reservations SET
    status = 'open',
    plan_id = p_plan_id,
    price_id = p_price_id,
    stripe_session_id = p_session_id,
    stripe_session_url = NULLIF(p_url, ''),
    expires_at = p_open_until,
    updated_at = now()
  WHERE clerk_id = p_clerk_id
    AND reservation_token = p_token
    AND status = 'pending';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_checkout_reservation(
  p_session_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_id IS NULL OR length(trim(p_session_id)) < 1 THEN
    RETURN;
  END IF;
  DELETE FROM public.checkout_reservations
  WHERE stripe_session_id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_open_checkout_reservation(text, uuid, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_open_checkout_reservation(text, uuid, text, text, text, text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.release_checkout_reservation(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_checkout_reservation(text)
  TO service_role;
