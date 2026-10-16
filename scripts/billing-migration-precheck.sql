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
-- together.
--
--   1. supabase/migrations/20261014000000_subscriptions_stripe_subscription_id_unique.sql
--   2. supabase/migrations/20261015000000_subscriptions_cancel_at_period_end.sql
--   3. supabase/migrations/20261015120000_media_cap_holds.sql
--   4. supabase/migrations/20261015140000_subscriptions_last_stripe_event_created.sql
--   5. supabase/migrations/20261015160000_checkout_reservations.sql
--   6. supabase/migrations/20261015170000_billing_subscription_conflicts.sql
--   7. supabase/migrations/20261015180000_media_cap_hold_expiry.sql
--
-- Preflight (this file):
--   - public.users and public.generation_jobs exist
--   - no duplicate non-null stripe_subscription_id values
--     (the unique index migration fails closed if any exist)
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
END $$;
