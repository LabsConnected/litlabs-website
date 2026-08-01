-- Schema contract tests for post-reset verification.
-- These run via `npx supabase test db` (pgTAP).
-- They verify the canonical schema contract after a clean db reset.

BEGIN;

-- Load pgTAP if not already loaded
CREATE EXTENSION IF NOT EXISTS pgtap;

-- ============================================
-- Plan: number of test assertions
-- ============================================
SELECT plan(44);

-- ============================================
-- 1. Users table: internal UUID + clerk_id
-- ============================================
SELECT has_table('public', 'users', 'public.users table exists');
SELECT has_column('public', 'users', 'id', 'users.id column exists');
SELECT col_type_is('public', 'users', 'id', 'uuid', 'users.id is UUID');
SELECT has_column('public', 'users', 'clerk_id', 'users.clerk_id column exists');
SELECT col_type_is('public', 'users', 'clerk_id', 'text', 'users.clerk_id is TEXT');
SELECT col_is_unique('public', 'users', 'clerk_id', 'users.clerk_id is UNIQUE');

-- ============================================
-- 2. Agents table: UUID primary key
-- ============================================
SELECT has_table('public', 'agents', 'public.agents table exists');
SELECT has_column('public', 'agents', 'id', 'agents.id column exists');
SELECT col_type_is('public', 'agents', 'id', 'uuid', 'agents.id is UUID');
SELECT has_column('public', 'agents', 'is_featured', 'agents.is_featured exists');

-- ============================================
-- 3. agent_logs: UUID FK to agents(id)
-- ============================================
SELECT has_table('public', 'agent_logs', 'public.agent_logs table exists');
SELECT has_column('public', 'agent_logs', 'agent_id', 'agent_logs.agent_id column exists');
SELECT col_type_is('public', 'agent_logs', 'agent_id', 'uuid', 'agent_logs.agent_id is UUID');

-- Verify FK constraint exists pointing to agents(id)
SELECT has_fk('public', 'agent_logs', 'agent_logs has foreign key(s)');
SELECT fk_ok(
    'public', 'agent_logs', 'agent_id',
    'public', 'agents', 'id',
    'agent_logs.agent_id FK → agents.id'
);

-- Verify ON DELETE SET NULL behavior using a temporary function
CREATE OR REPLACE FUNCTION pg_temp.test_fk_set_null()
RETURNS boolean AS $$
DECLARE
    test_agent_id uuid;
    test_log_id uuid;
    result_agent_id text;
BEGIN
    INSERT INTO public.agents (slug, display_name, role)
    VALUES ('__test_fk_agent', 'FK Test Agent', 'test')
    ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id INTO test_agent_id;

    INSERT INTO public.agent_logs (agent_id, level, message)
    VALUES (test_agent_id, 'info', 'FK SET NULL test')
    RETURNING id INTO test_log_id;

    DELETE FROM public.agents WHERE id = test_agent_id;

    SELECT agent_id::text INTO result_agent_id FROM public.agent_logs WHERE id = test_log_id;

    RETURN result_agent_id IS NULL;
END;
$$ LANGUAGE plpgsql;

SELECT is(
    pg_temp.test_fk_set_null(),
    true,
    'agent_logs.agent_id set to NULL on agent delete (ON DELETE SET NULL)'
);

-- ============================================
-- 4. Notifications: canonical recipient_id schema
-- ============================================
SELECT has_table('public', 'notifications', 'public.notifications table exists');
SELECT has_column('public', 'notifications', 'recipient_id', 'notifications.recipient_id exists');
SELECT col_type_is('public', 'notifications', 'recipient_id', 'uuid', 'notifications.recipient_id is UUID');
SELECT has_column('public', 'notifications', 'actor_id', 'notifications.actor_id exists');
SELECT has_column('public', 'notifications', 'entity_type', 'notifications.entity_type exists');
SELECT has_column('public', 'notifications', 'entity_id', 'notifications.entity_id exists');
SELECT has_column('public', 'notifications', 'content', 'notifications.content exists');

-- Verify canonical notifications does NOT have user_id (recipient_id schema untouched)
SELECT hasnt_column('public', 'notifications', 'user_id',
    'notifications does NOT have user_id (canonical recipient_id schema untouched by forward migration)');

-- ============================================
-- 4b. agent_system_notifications: forward migration contract
-- ============================================
SELECT has_table('public', 'agent_system_notifications',
    'agent_system_notifications table exists (created by forward migration 20260801000000)');
SELECT has_column('public', 'agent_system_notifications', 'user_id',
    'agent_system_notifications.user_id exists');
SELECT col_type_is('public', 'agent_system_notifications', 'user_id', 'uuid',
    'agent_system_notifications.user_id is UUID');
SELECT has_column('public', 'agent_system_notifications', 'type',
    'agent_system_notifications.type exists');
SELECT has_column('public', 'agent_system_notifications', 'priority',
    'agent_system_notifications.priority exists');
SELECT has_column('public', 'agent_system_notifications', 'title',
    'agent_system_notifications.title exists');
SELECT has_column('public', 'agent_system_notifications', 'body',
    'agent_system_notifications.body exists');
SELECT has_column('public', 'agent_system_notifications', 'data',
    'agent_system_notifications.data exists');
SELECT has_column('public', 'agent_system_notifications', 'channels',
    'agent_system_notifications.channels exists');
SELECT has_column('public', 'agent_system_notifications', 'read_at',
    'agent_system_notifications.read_at exists');
SELECT has_column('public', 'agent_system_notifications', 'sent_at',
    'agent_system_notifications.sent_at exists');
SELECT has_column('public', 'agent_system_notifications', 'created_at',
    'agent_system_notifications.created_at exists');
SELECT has_column('public', 'agent_system_notifications', 'updated_at',
    'agent_system_notifications.updated_at exists (added by forward migration trigger)');

-- ============================================
-- 5. RLS enabled on critical tables
-- ============================================
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users'),
    'RLS enabled on users'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agents'),
    'RLS enabled on agents'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_logs'),
    'RLS enabled on agent_logs'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications'),
    'RLS enabled on notifications'
);
SELECT ok(
    (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_system_notifications'),
    'RLS enabled on agent_system_notifications'
);

-- Verify agent_system_notifications_user_isolation policy exists
SELECT ok(
    (SELECT COUNT(*) > 0 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'agent_system_notifications'
       AND policyname = 'agent_system_notifications_user_isolation'),
    'agent_system_notifications_user_isolation policy exists'
);

-- ============================================
-- 6. Diagnostic SQL absent from migrations
-- ============================================
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations sm
        WHERE name LIKE '%explain_verify%'
    ),
    'diagnostic explain_verify script is NOT in migration history'
);

-- ============================================
-- Finish
-- ============================================
SELECT * FROM finish();

ROLLBACK;