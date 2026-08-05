-- ============================================
-- GDPR Data Retention Cleanup
--
-- Adds automatic cleanup for:
--   1. audit_events older than 90 days (GDPR Art. 5(1)(e) — storage limitation)
--   2. rate_limit_store entries older than 1 hour (rate limit windows are 60s-60min)
--
-- Uses pg_cron if available, otherwise provides a SQL function that can be
-- called manually or via an external cron/scheduled function.
--
-- Safe to re-run (IF NOT EXISTS / idempotent).
-- ============================================

-- ─── Retention function ────────────────────────────────────────────
-- Purges expired data. Call manually or via pg_cron.

CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS TABLE(
  audit_events_deleted BIGINT,
  rate_limit_deleted BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audit_deleted BIGINT := 0;
  v_rate_deleted BIGINT := 0;
BEGIN
  -- Delete audit_events older than 90 days
  DELETE FROM public.audit_events
  WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_audit_deleted = ROW_COUNT;

  -- Delete rate_limit_store entries older than 1 hour
  -- (rate limit windows are at most 60 minutes, so anything older is stale)
  DELETE FROM public.rate_limit_store
  WHERE window_start < EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour')::BIGINT;
  GET DIAGNOSTICS v_rate_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_audit_deleted, v_rate_deleted;
END;
$$;

-- Grant execute to service role (used by API routes)
GRANT EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;

-- ─── pg_cron schedule (if extension is available) ──────────────────
-- Runs hourly to keep tables clean. If pg_cron is not installed, this
-- block silently does nothing — call purge_expired_data() from an
-- external scheduler or API route instead.

DO $$
BEGIN
  -- Check if pg_cron extension exists
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Schedule hourly cleanup
    PERFORM cron.schedule(
      'gdpr-retention-cleanup',
      '0 * * * *',
      $$SELECT public.purge_expired_data();$$
    );
    RAISE NOTICE 'pg_cron: scheduled hourly GDPR retention cleanup';
  ELSE
    RAISE NOTICE 'pg_cron not installed — call purge_expired_data() manually or via external scheduler';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END;
$$;

-- ─── Documentation comment ─────────────────────────────────────────
COMMENT ON FUNCTION public.purge_expired_data() IS
  'GDPR retention cleanup: deletes audit_events > 90 days and rate_limit_store > 1 hour. '
  'Scheduled hourly via pg_cron if available, otherwise call manually.';
