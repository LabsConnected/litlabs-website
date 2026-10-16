-- Reserve a generation slot before the provider is called.
--
-- claim_media_cap_slot holds a per-user advisory lock, counts this month's
-- reservations plus completed jobs that predate the hold table, and inserts
-- the reservation in the same transaction. Parallel calls cannot both take
-- the last image, video, spend, or free-model slot.
--
-- Apply this file before the application code that calls the function.
-- If the function is missing, generation fails closed (402 usage_unavailable).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.release_media_cap_hold(uuid, text);
--   DROP FUNCTION IF EXISTS public.claim_media_cap_slot(uuid, text, text, text, text, integer, boolean, boolean, integer, integer, integer, integer, integer, timestamptz);
--   DROP FUNCTION IF EXISTS public.media_job_is_free(text, text, integer);
--   DROP TABLE IF EXISTS public.media_cap_holds;

CREATE TABLE IF NOT EXISTS public.media_cap_holds (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  modality text NOT NULL CHECK (modality IN ('image', 'video', 'music', 'speech')),
  provider text NOT NULL,
  model text NOT NULL,
  provider_cost_cents integer NOT NULL CHECK (provider_cost_cents >= 0),
  free_model boolean NOT NULL,
  units integer NOT NULL CHECK (units >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS media_cap_holds_user_created_idx
  ON public.media_cap_holds (user_id, created_at DESC);

ALTER TABLE public.media_cap_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_media_cap_holds ON public.media_cap_holds;
CREATE POLICY service_role_all_media_cap_holds ON public.media_cap_holds
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.media_cap_holds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.media_cap_holds TO service_role;

-- Known 0-cent image models. A stored cost of 0 is also free.
CREATE OR REPLACE FUNCTION public.media_job_is_free(
  p_provider text,
  p_model text,
  p_cost integer
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_cost, -1) = 0
    OR (p_provider || ':' || p_model) IN (
      'cloudflare:flux-1-schnell',
      'together:flux-1-schnell-free',
      'pollinations:flux'
    );
$$;

CREATE OR REPLACE FUNCTION public.claim_media_cap_slot(
  p_user_id uuid,
  p_request_id text,
  p_modality text,
  p_provider text,
  p_model text,
  p_provider_cost_cents integer,
  p_free_model boolean,
  p_billing_exempt boolean,
  p_max_images integer,
  p_max_videos integer,
  p_max_spend_cents integer,
  p_free_daily integer,
  p_units integer,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month timestamptz;
  v_day timestamptz;
  v_free integer;
  v_images integer;
  v_videos integer;
  v_spend integer;
  v_cost integer;
  v_units integer;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_request_id)) < 1 THEN
    RAISE EXCEPTION 'user and request id are required';
  END IF;
  IF p_modality NOT IN ('image', 'video', 'music', 'speech') THEN
    RAISE EXCEPTION 'invalid modality';
  END IF;
  IF p_units IS NULL OR p_units < 1 OR p_units > 8 THEN
    RAISE EXCEPTION 'units must be between 1 and 8';
  END IF;
  IF p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 THEN
    RAISE EXCEPTION 'provider cost must be non-negative';
  END IF;

  -- Serialize reservations for this user. Released when the transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- A retry of an allowed request keeps the slot it already reserved.
  IF EXISTS (
    SELECT 1 FROM public.media_cap_holds
    WHERE user_id = p_user_id AND request_id = p_request_id
  ) THEN
    RETURN jsonb_build_object('allowed', true, 'replay', true);
  END IF;

  v_units := p_units;
  v_cost := CASE WHEN p_free_model THEN 0 ELSE p_provider_cost_cents END;
  v_month := (date_trunc('month', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
  v_day := (date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');

  -- Live holds, plus completed jobs that have no hold yet (usage from before
  -- this table existed). The caller's own request is excluded so a job row
  -- inserted before the claim is not counted twice. In-flight jobs without a
  -- hold are not counted: the peer has not reserved yet, and the lock makes
  -- that peer see this row after we insert it.
  SELECT
    COALESCE(SUM(src.free_units) FILTER (WHERE src.created_at >= v_day), 0),
    COALESCE(SUM(src.image_units), 0),
    COALESCE(SUM(src.video_units), 0),
    COALESCE(SUM(src.spend_cents), 0)
  INTO v_free, v_images, v_videos, v_spend
  FROM (
    SELECT
      h.created_at,
      CASE WHEN h.free_model THEN h.units ELSE 0 END AS free_units,
      CASE WHEN h.modality = 'image' AND NOT h.free_model THEN h.units ELSE 0 END AS image_units,
      CASE WHEN h.modality = 'video' AND h.provider_cost_cents > 0 THEN h.units ELSE 0 END AS video_units,
      CASE WHEN NOT h.free_model THEN h.provider_cost_cents * h.units ELSE 0 END AS spend_cents
    FROM public.media_cap_holds h
    LEFT JOIN public.generation_jobs j
      ON j.user_id = h.user_id AND j.request_id = h.request_id
    WHERE h.user_id = p_user_id
      AND h.request_id <> p_request_id
      AND h.created_at >= v_month
      AND h.created_at <= p_now
      AND (
        j.id IS NULL
        OR (
          j.status IN ('queued', 'generating', 'processing', 'persisting', 'completed')
          AND COALESCE(j.refund_status, 'none') <> 'refunded'
        )
      )
    UNION ALL
    SELECT
      j.created_at,
      CASE
        WHEN public.media_job_is_free(j.provider, j.model, j.actual_provider_cost_cents) THEN 1
        ELSE 0
      END AS free_units,
      CASE
        WHEN j.modality = 'image'
          AND NOT public.media_job_is_free(j.provider, j.model, j.actual_provider_cost_cents)
        THEN 1 ELSE 0
      END AS image_units,
      CASE
        WHEN j.modality = 'video'
          AND NOT public.media_job_is_free(j.provider, j.model, j.actual_provider_cost_cents)
        THEN 1 ELSE 0
      END AS video_units,
      CASE
        WHEN NOT public.media_job_is_free(j.provider, j.model, j.actual_provider_cost_cents)
        THEN GREATEST(COALESCE(j.actual_provider_cost_cents, 0), 0)
        ELSE 0
      END AS spend_cents
    FROM public.generation_jobs j
    WHERE j.user_id = p_user_id
      AND j.request_id <> p_request_id
      AND j.created_at >= v_month
      AND j.created_at <= p_now
      AND j.status = 'completed'
      AND COALESCE(j.refund_status, 'none') <> 'refunded'
      AND NOT EXISTS (
        SELECT 1 FROM public.media_cap_holds h
        WHERE h.user_id = j.user_id AND h.request_id = j.request_id
      )
  ) src;

  IF p_free_model THEN
    IF v_free + v_units > p_free_daily THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status', 429,
        'reason', 'free_model_daily_cap',
        'error', format('Free generation limit is %s per day. Today''s limit is reached.', p_free_daily)
      );
    END IF;
  ELSIF NOT p_billing_exempt THEN
    IF p_modality = 'image' AND v_images + v_units > p_max_images THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status', 429,
        'reason', 'monthly_image_cap',
        'error', format('Paid image limit is %s this month.', p_max_images)
      );
    END IF;
    IF p_modality = 'video' AND v_cost > 0 AND v_videos + v_units > p_max_videos THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status', 429,
        'reason', 'monthly_video_cap',
        'error', format('Video limit is %s this month.', p_max_videos)
      );
    END IF;
    IF v_cost > 0 AND v_spend + (v_cost * v_units) > p_max_spend_cents THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'status', 402,
        'reason', 'provider_spend_cap',
        'error', format(
          'Provider spend cap is %s cents this month. This request would reach %s cents.',
          p_max_spend_cents,
          v_spend + (v_cost * v_units)
        )
      );
    END IF;
  END IF;

  -- Exempt paid calls do not consume a monthly slot. Free calls do, including
  -- exempt callers, so the daily cap still serializes.
  IF p_free_model OR NOT p_billing_exempt THEN
    INSERT INTO public.media_cap_holds (
      user_id, request_id, modality, provider, model,
      provider_cost_cents, free_model, units, created_at
    ) VALUES (
      p_user_id, p_request_id, p_modality, p_provider, p_model,
      v_cost, p_free_model, v_units, p_now
    );
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_media_cap_hold(
  p_user_id uuid,
  p_request_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  DELETE FROM public.media_cap_holds
  WHERE user_id = p_user_id AND request_id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.media_job_is_free(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_job_is_free(text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_media_cap_slot(
  uuid, text, text, text, text, integer, boolean, boolean, integer, integer, integer, integer, integer, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_cap_slot(
  uuid, text, text, text, text, integer, boolean, boolean, integer, integer, integer, integer, integer, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.release_media_cap_hold(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_media_cap_hold(uuid, text) TO service_role;
