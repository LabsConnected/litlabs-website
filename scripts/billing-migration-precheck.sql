-- Read-only preflight for the paid-beta billing migrations.
-- Do not apply schema changes from this file.
--
-- Deployment order: run the migrations before the application code that
-- reads the new columns or calls claim_media_cap_slot. Code that ships
-- first fails closed on a missing function (generation returns 402
-- usage_unavailable; checkout returns 503) and can 500 on a missing
-- cancel_at_period_end or last_stripe_event_created column, or when a
-- duplicate subscription cannot be recorded. Apply 20261015140000 before
-- the webhook that orders events by that column. Apply 20261015160000
-- before checkout reservations, 20261015170000 before the duplicate
-- subscription guard, and 20261015180000 before settle/sweep. The replaced
-- claim function reads settled_at, so the column and the function ship
-- together. Apply 20261015200000 before the webhook that calls
-- apply_subscription_event. That webhook returns 500 when the function
-- is missing. Apply 20261015210000 before checkout expires a prior
-- session, and 20261015220000 to schedule the media-hold sweep. The 24
-- hour claim filter remains the backstop when cron is absent.
--
--   1. supabase/migrations/20261014000000_subscriptions_stripe_subscription_id_unique.sql
--   2. supabase/migrations/20261015000000_subscriptions_cancel_at_period_end.sql
--   3. supabase/migrations/20261015120000_media_cap_holds.sql
--   4. supabase/migrations/20261015140000_subscriptions_last_stripe_event_created.sql
--   5. supabase/migrations/20261015160000_checkout_reservations.sql
--   6. supabase/migrations/20261015170000_billing_subscription_conflicts.sql
--   7. supabase/migrations/20261015180000_media_cap_hold_expiry.sql
--   8. supabase/migrations/20261015200000_apply_subscription_event.sql
--   9. supabase/migrations/20261015210000_checkout_session_lease.sql
--  10. supabase/migrations/20261015220000_schedule_media_cap_sweep.sql
--  11. supabase/migrations/20261015230000_checkout_block_protected_subscription.sql
--  12. supabase/migrations/20261015240000_stripe_event_claim_token.sql
--  13. supabase/migrations/20261019120000_settled_invoice_grants.sql
--      Do NOT apply 13 to any hosted database from automation. It closes
--      upgrade_delta so only a settled invoice.paid inserts subscription credits.
--
-- 11 replaces begin_checkout_reservation so unpaid, paused, incomplete,
-- refunded, and disputed cannot open a second Checkout. 12 adds
-- stripe_events.claim_token, the claim/finalize/release functions, and
-- billing_alerts. Apply 12 before the webhook that calls claim_stripe_event.
--
-- Preflight (this file):
--   - public.users and public.generation_jobs exist
--   - no duplicate non-null stripe_subscription_id values
--     (the unique index migration fails closed if any exist)
--   - no user has more than one protected subscription row
--     (status other than canceled or incomplete_expired, with a
--     subscription id). The partial unique index fails closed if any exist.
--
-- Rollback, after the application code that depends on them is reverted:
--   20261014000000:
--     DROP INDEX IF EXISTS public.subscriptions_stripe_subscription_id_uidx;
--   20261015000000:
--     ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS cancel_at_period_end;
--     -- current_period_end predated this migration. Do not drop it.
--   20261015120000:
--     DROP FUNCTION IF EXISTS public.release_media_cap_hold(uuid, text);
--     DROP FUNCTION IF EXISTS public.claim_media_cap_slot(uuid, text, text, text, text, integer, boolean, boolean, integer, integer, integer, integer, integer, timestamptz);
--     DROP FUNCTION IF EXISTS public.media_job_is_free(text, text, integer);
--     DROP TABLE IF EXISTS public.media_cap_holds;
--   20261015140000:
--     ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS last_stripe_event_created;
--   20261015160000:
--     DROP FUNCTION IF EXISTS public.abort_checkout_reservation(text, uuid);
--     DROP FUNCTION IF EXISTS public.commit_checkout_reservation(text, uuid, text, text, timestamptz);
--     DROP FUNCTION IF EXISTS public.begin_checkout_reservation(text, uuid, text, text, timestamptz, integer);
--     DROP TABLE IF EXISTS public.checkout_reservations;
--   20261015170000:
--     DROP TABLE IF EXISTS public.billing_subscription_conflicts;
--   20261015180000:
--     DROP FUNCTION IF EXISTS public.sweep_expired_media_cap_holds(timestamptz, interval);
--     DROP FUNCTION IF EXISTS public.settle_media_cap_hold(uuid, text, timestamptz);
--     ALTER TABLE public.media_cap_holds DROP COLUMN IF EXISTS settled_at;
--     Restore claim_media_cap_slot from 20261015120000_media_cap_holds.sql.
--   20261015200000:
--     DROP FUNCTION IF EXISTS public.apply_subscription_event(uuid, text, text, text, bigint, boolean, text, boolean, text, text, boolean, text, text, text, timestamptz, timestamptz, boolean, text, text, integer, text, text, text, timestamptz, text, jsonb);
--     DROP INDEX IF EXISTS public.subscriptions_one_protected_per_user;
--   20261015210000:
--     DROP FUNCTION IF EXISTS public.release_checkout_reservation(text);
--     DROP FUNCTION IF EXISTS public.restore_open_checkout_reservation(text, uuid, text, text, text, text, timestamptz);
--     Restore begin_checkout_reservation from 20261015160000_checkout_reservations.sql.
--   20261015220000:
--     Unschedule sweep-expired-media-cap-holds when pg_cron is installed.
--     The 24 hour claim filter still ignores stale unsettled holds.
--   20261015230000:
--     Restore begin_checkout_reservation from 20261015210000_checkout_session_lease.sql.
--   20261015240000:
--     DROP FUNCTION IF EXISTS public.release_stripe_event(text, uuid);
--     DROP FUNCTION IF EXISTS public.finalize_stripe_event(text, uuid, text);
--     DROP FUNCTION IF EXISTS public.claim_stripe_event(text, text, uuid, timestamptz);
--     ALTER TABLE public.stripe_events DROP COLUMN IF EXISTS claim_token;
--     DROP TABLE IF EXISTS public.billing_alerts;

DO $$
DECLARE
  dup_count integer;
  users_ok boolean;
  jobs_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) INTO users_ok;
  IF NOT users_ok THEN
    RAISE EXCEPTION 'precheck failed: public.users is missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'generation_jobs'
  ) INTO jobs_ok;
  IF NOT jobs_ok THEN
    RAISE EXCEPTION 'precheck failed: public.generation_jobs is missing';
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT stripe_subscription_id
    FROM public.subscriptions
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY 1
    HAVING count(*) > 1
  ) duplicates;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'precheck failed: % duplicate stripe_subscription_id values; do not apply 20261014000000', dup_count;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT user_id
    FROM public.subscriptions
    WHERE stripe_subscription_id IS NOT NULL
      AND stripe_subscription_id <> ''
      AND status IS NOT NULL
      AND status NOT IN ('canceled', 'incomplete_expired')
    GROUP BY user_id
    HAVING count(*) > 1
  ) protected_duplicates;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'precheck failed: % users have more than one protected subscription; do not apply 20261015200000', dup_count;
  END IF;
END $$;
