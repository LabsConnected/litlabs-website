-- Token-fenced Stripe webhook claims.
--
-- A stale processing row used to be deleted by stripe_event_id alone. Two
-- workers could both delete it and both process the event. claim_stripe_event
-- inserts or takes over under FOR UPDATE, and only the claim_token that won
-- can finalize or release the row.
--
-- billing_alerts records dispute notifications. The webhook also logs
-- [stripe][alert] for the log drain. Apply before the webhook that calls
-- these functions. A missing function fails the claim and returns HTTP 500.
--
-- Rollback, after that webhook is reverted:
--   DROP FUNCTION IF EXISTS public.release_stripe_event(text, uuid);
--   DROP FUNCTION IF EXISTS public.finalize_stripe_event(text, uuid, text);
--   DROP FUNCTION IF EXISTS public.claim_stripe_event(text, text, uuid, timestamptz);
--   ALTER TABLE public.stripe_events DROP COLUMN IF EXISTS claim_token;
--   DROP TABLE IF EXISTS public.billing_alerts;

ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS claim_token uuid;

CREATE TABLE IF NOT EXISTS public.billing_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL,
  alert_type text NOT NULL,
  stripe_object_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stripe_event_id, alert_type)
);

ALTER TABLE public.billing_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_billing_alerts ON public.billing_alerts;
CREATE POLICY service_role_all_billing_alerts
  ON public.billing_alerts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.billing_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.billing_alerts TO service_role;

CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  p_stripe_event_id text,
  p_event_type text,
  p_claim_token uuid,
  p_stale_before timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result text;
  v_token uuid;
  v_processed timestamptz;
  v_updated integer;
BEGIN
  IF p_stripe_event_id IS NULL OR length(btrim(p_stripe_event_id)) = 0
    OR p_claim_token IS NULL OR p_stale_before IS NULL THEN
    RAISE EXCEPTION 'claim_stripe_event requires an event id, token, and stale cutoff';
  END IF;

  INSERT INTO public.stripe_events (stripe_event_id, event_type, result, claim_token)
  VALUES (p_stripe_event_id, p_event_type, 'processing', p_claim_token)
  ON CONFLICT (stripe_event_id) DO NOTHING;

  IF FOUND THEN
    RETURN 'owned';
  END IF;

  SELECT result, claim_token, processed_at
  INTO v_result, v_token, v_processed
  FROM public.stripe_events
  WHERE stripe_event_id = p_stripe_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'in_progress';
  END IF;

  IF v_result IS DISTINCT FROM 'processing' THEN
    RETURN 'duplicate';
  END IF;

  IF v_processed > p_stale_before THEN
    RETURN 'in_progress';
  END IF;

  UPDATE public.stripe_events
  SET claim_token = p_claim_token,
      event_type = p_event_type,
      result = 'processing',
      processed_at = clock_timestamp()
  WHERE stripe_event_id = p_stripe_event_id
    AND result = 'processing'
    AND claim_token IS NOT DISTINCT FROM v_token
    AND processed_at <= p_stale_before;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    RETURN 'owned';
  END IF;
  RETURN 'in_progress';
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_stripe_event(
  p_stripe_event_id text,
  p_claim_token uuid,
  p_result text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_result IS NULL OR length(btrim(p_result)) = 0 OR p_result = 'processing' THEN
    RAISE EXCEPTION 'finalize_stripe_event requires a terminal result';
  END IF;

  UPDATE public.stripe_events
  SET result = p_result,
      processed_at = clock_timestamp()
  WHERE stripe_event_id = p_stripe_event_id
    AND claim_token = p_claim_token
    AND result = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_stripe_event(
  p_stripe_event_id text,
  p_claim_token uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  DELETE FROM public.stripe_events
  WHERE stripe_event_id = p_stripe_event_id
    AND claim_token = p_claim_token
    AND result = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    RETURN 'released';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stripe_events WHERE stripe_event_id = p_stripe_event_id
  ) THEN
    RETURN 'lost';
  END IF;
  RETURN 'absent';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text, text, uuid, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_stripe_event(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stripe_event(text, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.release_stripe_event(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stripe_event(text, uuid)
  TO service_role;
