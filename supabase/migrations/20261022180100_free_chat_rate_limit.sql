-- #684 shared free-chat limiter.
--
-- NOT APPLIED. Do not run this migration from the #684 draft.
-- Uses the existing public.rate_limit_store. No new table.
-- One transaction holds pg_advisory_xact_lock for the user, checks the
-- minute window and the day window, and increments neither when either
-- window is exhausted. Two overlapping calls cannot both pass.
--
-- Fail-closed lives in the application: if this function is missing or
-- errors, plain Studio chat is denied.

BEGIN;

CREATE OR REPLACE FUNCTION public.consume_free_chat_limit(
  p_user_key text,
  p_per_minute integer,
  p_per_day integer,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now integer;
  v_minute_count integer;
  v_minute_start integer;
  v_day_count integer;
  v_day_start integer;
  v_minute_key text;
  v_day_key text;
BEGIN
  IF p_user_key IS NULL OR length(trim(p_user_key)) = 0 THEN
    RETURN QUERY SELECT false, 60;
    RETURN;
  END IF;
  IF p_per_minute < 1 OR p_per_day < 1 THEN
    RETURN QUERY SELECT false, 60;
    RETURN;
  END IF;

  v_now := EXTRACT(EPOCH FROM p_now)::integer;
  v_minute_key := 'freechat:' || trim(p_user_key) || ':m';
  v_day_key := 'freechat:' || trim(p_user_key) || ':d';

  PERFORM pg_advisory_xact_lock(hashtextextended('freechat:' || trim(p_user_key), 0));

  SELECT count, window_start INTO v_minute_count, v_minute_start
  FROM public.rate_limit_store
  WHERE key = v_minute_key
  FOR UPDATE;

  SELECT count, window_start INTO v_day_count, v_day_start
  FROM public.rate_limit_store
  WHERE key = v_day_key
  FOR UPDATE;

  IF v_minute_start IS NULL OR v_now - v_minute_start >= 60 THEN
    v_minute_count := 0;
    v_minute_start := v_now;
  END IF;
  IF v_day_start IS NULL OR v_now - v_day_start >= 86400 THEN
    v_day_count := 0;
    v_day_start := v_now;
  END IF;

  IF v_minute_count >= p_per_minute THEN
    RETURN QUERY SELECT false, GREATEST(1, v_minute_start + 60 - v_now);
    RETURN;
  END IF;
  IF v_day_count >= p_per_day THEN
    RETURN QUERY SELECT false, GREATEST(1, v_day_start + 86400 - v_now);
    RETURN;
  END IF;

  INSERT INTO public.rate_limit_store (key, count, window_start, updated_at)
  VALUES (v_minute_key, v_minute_count + 1, v_minute_start, p_now)
  ON CONFLICT (key) DO UPDATE
  SET count = EXCLUDED.count,
      window_start = EXCLUDED.window_start,
      updated_at = EXCLUDED.updated_at;

  INSERT INTO public.rate_limit_store (key, count, window_start, updated_at)
  VALUES (v_day_key, v_day_count + 1, v_day_start, p_now)
  ON CONFLICT (key) DO UPDATE
  SET count = EXCLUDED.count,
      window_start = EXCLUDED.window_start,
      updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT true, 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_free_chat_limit(text, integer, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_free_chat_limit(text, integer, integer, timestamptz)
  TO service_role;

COMMIT;
