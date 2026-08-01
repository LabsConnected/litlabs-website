-- Upgrade-path postcondition assertions
--
-- Run this AFTER `supabase migration up --local --include-all` to verify
-- the forward migration 20260801000000 applied correctly on top of a
-- pre-forward database. Also run it again after re-running the entire
-- forward migration SQL with ON_ERROR_STOP=1 to prove idempotency.

\set ON_ERROR_STOP on

-- ============================================
-- 1. agent_system_notifications exists with full schema
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_system_notifications'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications does not exist after upgrade';
  END IF;

  -- Verify all expected columns
  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'user_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.user_id missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'type';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.type missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'priority';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.priority missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'title';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.title missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'body';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.body missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'data';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.data missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'channels';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.channels missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'read_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.read_at missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'sent_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.sent_at missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'created_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.created_at missing'; END IF;

  PERFORM column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications' AND column_name = 'updated_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications.updated_at missing'; END IF;

  RAISE NOTICE 'POSTCONDITION OK: agent_system_notifications exists with all 12 columns';
END $$;

-- ============================================
-- 2. Canonical notifications remains untouched
-- ============================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: notifications.user_id was added (canonical schema altered)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'recipient_id'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: notifications.recipient_id was removed';
  END IF;

  RAISE NOTICE 'POSTCONDITION OK: canonical notifications schema unchanged (recipient_id preserved)';
END $$;

-- ============================================
-- 3. Sentinel notification row survives the upgrade
-- ============================================
DO $$
DECLARE
  sentinel_count integer;
BEGIN
  SELECT COUNT(*) INTO sentinel_count
  FROM public.notifications
  WHERE content = 'SENTINEL_UPGRADE_TEST_ROW';

  IF sentinel_count != 1 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: sentinel row count = % (expected 1)', sentinel_count;
  END IF;

  RAISE NOTICE 'POSTCONDITION OK: sentinel notification row survived upgrade';
END $$;

-- ============================================
-- 4. RLS enabled on agent_system_notifications
-- ============================================
DO $$
DECLARE
  rls_enabled boolean;
BEGIN
  SELECT rowsecurity INTO rls_enabled
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'agent_system_notifications';

  IF rls_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on agent_system_notifications';
  END IF;

  RAISE NOTICE 'POSTCONDITION OK: RLS enabled on agent_system_notifications';
END $$;

-- ============================================
-- 5. Policy exists
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_system_notifications'
      AND policyname = 'agent_system_notifications_user_isolation'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: agent_system_notifications_user_isolation policy missing';
  END IF;

  RAISE NOTICE 'POSTCONDITION OK: user_isolation policy exists';
END $$;

-- ============================================
-- 6. Indexes exist
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'agent_system_notifications'
      AND indexname = 'idx_agent_system_notifications_type'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: idx_agent_system_notifications_type missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'agent_system_notifications'
      AND indexname = 'idx_agent_system_notifications_user_id_read'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: idx_agent_system_notifications_user_id_read missing';
  END IF;

  RAISE NOTICE 'POSTCONDITION OK: all indexes exist';
END $$;

-- ============================================
-- 7. Trigger exists
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.agent_system_notifications'::regclass
      AND tgname = 'set_agent_system_notifications_updated_at'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: set_agent_system_notifications_updated_at trigger missing';
  END IF;

  RAISE NOTICE 'POSTCONDITION OK: updated_at trigger exists';
END $$;

-- ============================================
-- 8. Grants for authenticated + service_role
-- ============================================
DO $$
DECLARE
  auth_grants text[];
  service_grants text[];
BEGIN
  SELECT array_agg(privilege_type ORDER BY privilege_type) INTO auth_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications'
    AND grantee = 'authenticated';

  IF auth_grants IS NULL OR array_length(auth_grants, 1) < 4 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: authenticated grants incomplete: %', auth_grants;
  END IF;

  SELECT array_agg(privilege_type ORDER BY privilege_type) INTO service_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'agent_system_notifications'
    AND grantee = 'service_role';

  IF service_grants IS NULL OR array_length(service_grants, 1) < 4 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: service_role grants incomplete: %', service_grants;
  END IF;

  RAISE NOTICE 'POSTCONDITION OK: grants for authenticated (%) and service_role (%)',
    auth_grants, service_grants;
END $$;

-- ============================================
-- 9. Cleanup sentinel data
-- ============================================
DELETE FROM public.notifications WHERE content = 'SENTINEL_UPGRADE_TEST_ROW';
DELETE FROM public.users WHERE clerk_id = 'sentinel_upgrade_test';

DO $$ BEGIN RAISE NOTICE 'Cleanup: sentinel data removed'; END $$;
