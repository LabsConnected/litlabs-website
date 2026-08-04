-- Upgrade-path validation for agent_system_notifications forward migration
--
-- This script validates the REAL upgrade path, not just a post-reset schema
-- inspection. It must be run AFTER `supabase db reset --local --version
-- 20260728220000` (the migration immediately before 20260801000000) and
-- BEFORE `supabase migration up --local`.
--
-- Procedure:
--   1. npx supabase db reset --local --no-seed --version 20260728220000
--   2. psql -f this file (asserts preconditions + inserts sentinel)
--   3. npx supabase migration up --local --include-all
--   4. psql -f supabase/tests/upgrade_path_postconditions.sql
--   5. psql -f supabase/migrations/20260801000000_create_agent_system_notifications.sql
--      (re-run entire forward migration with ON_ERROR_STOP=1 for idempotency)
--   6. psql -f supabase/tests/upgrade_path_postconditions.sql (verify still valid)
--
-- This file = Step 2: precondition assertions + sentinel insertion.

\set ON_ERROR_STOP on

-- ============================================
-- 1. Preconditions: canonical notifications has recipient_id, NOT user_id
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'recipient_id'
  ) THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: notifications.recipient_id does not exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: notifications.user_id exists (should not)';
  END IF;

  RAISE NOTICE 'PRECONDITION OK: notifications has recipient_id, not user_id';
END $$;

-- ============================================
-- 2. Preconditions: agent_system_notifications does NOT exist yet
-- ============================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_system_notifications'
  ) THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: agent_system_notifications already exists (forward migration should not have run yet)';
  END IF;

  RAISE NOTICE 'PRECONDITION OK: agent_system_notifications does not exist yet';
END $$;

-- ============================================
-- 3. Insert sentinel notification row (will verify it survives the upgrade)
-- ============================================
DO $$
DECLARE
  sentinel_user_id uuid;
  sentinel_notification_id uuid;
BEGIN
  INSERT INTO public.users (clerk_id, email)
  VALUES ('sentinel_upgrade_test', 'sentinel-upgrade@test.local')
  ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email
  RETURNING id INTO sentinel_user_id;

  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, content)
  VALUES (sentinel_user_id, NULL, 'follow', 'user', sentinel_user_id, 'SENTINEL_UPGRADE_TEST_ROW')
  RETURNING id INTO sentinel_notification_id;

  RAISE NOTICE 'Sentinel inserted: notification_id = %, user_id = %',
    sentinel_notification_id, sentinel_user_id;
END $$;
