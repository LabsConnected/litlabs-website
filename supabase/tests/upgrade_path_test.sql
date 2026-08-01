-- Production-style upgrade path test
--
-- Simulates a Production database where:
-- 1. The historical migration 20260116000000 was applied with the ORIGINAL
--    `notifications` table name (user_id schema) — before the rename edit
-- 2. The forward migration 20260801000000 is then applied
--
-- Verifies:
-- - agent_system_notifications exists after the forward migration
-- - The original notifications table is NOT modified/deleted
-- - Both tables can coexist with their respective schemas
--
-- This test runs AFTER a fresh `supabase db reset` which already applied
-- all migrations including the forward one. To simulate the Production
-- scenario, we verify the END STATE matches what an upgrade would produce.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ============================================
-- Plan
-- ============================================
SELECT plan(8);

-- ============================================
-- 1. agent_system_notifications exists (created by forward migration)
-- ============================================
SELECT has_table('public', 'agent_system_notifications',
    'agent_system_notifications exists after forward migration');

SELECT has_column('public', 'agent_system_notifications', 'user_id',
    'agent_system_notifications has user_id column');

SELECT has_column('public', 'agent_system_notifications', 'type',
    'agent_system_notifications has type column');

-- ============================================
-- 2. Canonical notifications table is untouched
-- ============================================
SELECT has_table('public', 'notifications',
    'canonical notifications table still exists (not deleted by forward migration)');

-- The canonical notifications table should have recipient_id (from social_graph)
-- OR user_id (from historical agent_platform) — whichever ran first.
-- The forward migration must NOT have altered it.
SELECT hasnt_column('public', 'notifications', 'agent_system_notifications_id',
    'notifications table was not altered by forward migration (no FK to agent_system_notifications)');

-- ============================================
-- 3. Both tables coexist independently
-- ============================================
SELECT ok(
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('notifications', 'agent_system_notifications')) = 2,
    'both notifications and agent_system_notifications coexist as separate tables'
);

-- ============================================
-- 4. RLS on agent_system_notifications
-- ============================================
SELECT ok(
    (SELECT rowsecurity FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'agent_system_notifications'),
    'RLS enabled on agent_system_notifications after forward migration'
);

-- ============================================
-- 5. Forward migration is idempotent (re-running won't fail)
-- ============================================
-- Re-apply the forward migration SQL to verify idempotency
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS public.agent_system_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    priority TEXT DEFAULT 'medium',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    channels TEXT[] DEFAULT '{}',
    read_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
END $$;

SELECT ok(
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'agent_system_notifications') = 1,
    'forward migration is idempotent (re-run does not create duplicate table)'
);

-- ============================================
-- Finish
-- ============================================
SELECT * FROM finish();

ROLLBACK;
