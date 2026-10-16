-- One open checkout per Clerk user.
--
-- Concurrent Creator and Pro checkouts used to both miss the subscription
-- row and each create a Stripe session. begin_checkout_reservation holds a
-- per-clerk advisory lock and keeps a single row (primary key clerk_id).
-- A pending lease covers the Stripe round trip. An open session is reused
-- for the same price and blocks a second price until it expires.
--
-- Apply before the checkout route that calls these functions. If the
-- function is missing, checkout returns 503 and does not create a session.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.abort_checkout_reservation(text, uuid);
--   DROP FUNCTION IF EXISTS public.commit_checkout_reservation(text, uuid, text, text, timestamptz);
--   DROP FUNCTION IF EXISTS public.begin_checkout_reservation(text, uuid, text, text, timestamptz, integer);
--   DROP TABLE IF EXISTS public.checkout_reservations;

CREATE TABLE IF NOT EXISTS public.checkout_reservations (
  clerk_id text PRIMARY KEY,
  user_id uuid,
  plan_id text NOT NULL,
  price_id text NOT NULL,
  stripe_session_id text,
  stripe_session_url text,
  status text NOT NULL CHECK (status IN ('pending', 'open')),
  reservation_token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS checkout_reservations_session_uidx
  ON public.checkout_reservations (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

ALTER TABLE public.checkout_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_checkout_reservations ON public.checkout_reservations;
CREATE POLICY service_role_all_checkout_reservations ON public.checkout_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.checkout_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_reservations TO service_role;

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
    RETURN jsonb_build_object(
      'action', 'in_progress',
      'plan_id', rec.plan_id,
      'price_id', rec.price_id
    );
  END IF;

  lease := GREATEST(COALESCE(p_lease_seconds, 60), 15);
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

  RETURN jsonb_build_object('action', 'create', 'token', token);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_checkout_reservation(
  p_clerk_id text,
  p_token uuid,
  p_session_id text,
  p_url text,
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
  UPDATE public.checkout_reservations
  SET status = 'open',
      stripe_session_id = p_session_id,
      stripe_session_url = p_url,
      expires_at = p_open_until,
      updated_at = now()
  WHERE clerk_id = p_clerk_id
    AND reservation_token = p_token
    AND status = 'pending';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.abort_checkout_reservation(
  p_clerk_id text,
  p_token uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('checkout:' || p_clerk_id, 0));
  DELETE FROM public.checkout_reservations
  WHERE clerk_id = p_clerk_id
    AND reservation_token = p_token
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.begin_checkout_reservation(text, uuid, text, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_checkout_reservation(text, uuid, text, text, timestamptz, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.commit_checkout_reservation(text, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_checkout_reservation(text, uuid, text, text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.abort_checkout_reservation(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abort_checkout_reservation(text, uuid)
  TO service_role;
