-- Release cap holds that a failed, timed-out, or crashed generation left behind.
--
-- settled_at marks a hold whose generation succeeded. claim_media_cap_slot
-- still counts settled holds and completed jobs. An unsettled hold with no
-- completed job stops counting after 24 hours, and sweep_expired_media_cap_holds
-- deletes it. Provider failure should call release_media_cap_hold immediately;
-- the sweep is the crash and timeout backstop.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.sweep_expired_media_cap_holds(timestamptz, interval);
--   DROP FUNCTION IF EXISTS public.settle_media_cap_hold(uuid, text, timestamptz);
--   ALTER TABLE public.media_cap_holds DROP COLUMN IF EXISTS settled_at;
--   Restore claim_media_cap_slot from 20261015120000_media_cap_holds.sql.

ALTER TABLE public.media_cap_holds
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

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
      AND (
        h.settled_at IS NOT NULL
        OR (
          j.status = 'completed'
          AND COALESCE(j.refund_status, 'none') <> 'refunded'
        )
        OR h.created_at >= p_now - interval '24 hours'
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


CREATE OR REPLACE FUNCTION public.settle_media_cap_hold(
  p_user_id uuid,
  p_request_id text,
  p_now timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.media_cap_holds
  SET settled_at = COALESCE(p_now, now())
  WHERE user_id = p_user_id
    AND request_id = p_request_id
    AND settled_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_expired_media_cap_holds(
  p_now timestamptz,
  p_max_age interval DEFAULT interval '24 hours'
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.media_cap_holds h
  WHERE EXISTS (
    SELECT 1 FROM public.generation_jobs j
    WHERE j.user_id = h.user_id
      AND j.request_id = h.request_id
      AND j.status IN ('failed', 'cancelled', 'canceled', 'error')
  )
  OR (
    h.settled_at IS NULL
    AND h.created_at < p_now - COALESCE(p_max_age, interval '24 hours')
    AND NOT EXISTS (
      SELECT 1 FROM public.generation_jobs j
      WHERE j.user_id = h.user_id
        AND j.request_id = h.request_id
        AND j.status = 'completed'
        AND COALESCE(j.refund_status, 'none') <> 'refunded'
    )
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_media_cap_hold(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_media_cap_hold(uuid, text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.sweep_expired_media_cap_holds(timestamptz, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_media_cap_holds(timestamptz, interval)
  TO service_role;
