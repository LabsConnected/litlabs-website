-- Hourly sweep of media-cap holds that a failed or crashed generation left behind.
--
-- claim_media_cap_slot already stops counting an unsettled hold that has no
-- completed, unrefunded job once the hold is older than 24 hours. That
-- predicate is the backstop: a customer is not blocked for more than a day
-- even if this job never runs. The sweep deletes those rows, and deletes
-- holds whose job already failed. Failed job rows stay until the sweep runs.
--
-- pg_cron is optional. When it is absent, POST /api/billing/sweep-media-holds
-- with the x-cron-secret header runs the same function.
--
-- Rollback:
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--       PERFORM cron.unschedule('sweep-expired-media-cap-holds');
--     END IF;
--   EXCEPTION WHEN OTHERS THEN
--     NULL;
--   END $$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'sweep-expired-media-cap-holds',
      '15 * * * *',
      $cron$SELECT public.sweep_expired_media_cap_holds(now(), interval '24 hours');$cron$
    );
    RAISE NOTICE 'pg_cron: scheduled hourly media cap hold sweep';
  ELSE
    RAISE NOTICE 'pg_cron not installed — POST /api/billing/sweep-media-holds or call sweep_expired_media_cap_holds manually. The 24 hour claim filter still ignores stale unsettled holds.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END;
$do$;
