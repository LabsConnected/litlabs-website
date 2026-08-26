-- ============================================
-- Comprehensive RLS Hardening — deny all client access
--
-- Architecture: Clerk = identity, Supabase = database/storage,
-- service_role = server only. Browser never gets privileged database access.
--
-- This migration:
--   1. Ensures RLS is ENABLED on every public-schema table
--   2. Adds explicit deny-all policies for anon + authenticated roles
--      on every table that should be server-only
--   3. Preserves existing public-read policies (agents, user_media, posts)
--   4. Removes active_tasks from public-read (was leaking user input/result/error)
--
-- Safe to re-run (DROP IF EXISTS before CREATE).
-- ============================================

-- Helper: deny direct client access (anon + authenticated) for a table
-- Does NOT drop existing public-read policies — those are managed separately.
CREATE OR REPLACE FUNCTION public._rls_deny_all_client_access(table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Drop old deny policies if they exist
  EXECUTE format('DROP POLICY IF EXISTS api_deny_anon ON public.%I', table_name);
  EXECUTE format('DROP POLICY IF EXISTS api_deny_authenticated ON public.%I', table_name);
  -- Create deny-all for anon
  EXECUTE format(
    'CREATE POLICY api_deny_anon ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)',
    table_name
  );
  -- Create deny-all for authenticated (Supabase Auth users — not used by our app,
  -- but deny anyway to prevent any direct PostgREST access)
  EXECUTE format(
    'CREATE POLICY api_deny_authenticated ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)',
    table_name
  );
END;
$$;

-- ── Ensure RLS is enabled on every public-schema table ──
-- This catches any table created by a migration that forgot to enable RLS.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END;
$$;

-- ── Apply deny-all to every public-schema table ──
-- Then selectively re-allow public read on specific tables below.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    -- Skip tables that have explicit public-read policies
    -- (they are handled individually below)
    -- NOTE: active_tasks is NOT public-read — it contains user input/result/error
    -- data that is private. Only agents, user_media, and posts are public-read.
    IF t.relname IN ('agents', 'user_media', 'posts') THEN
      CONTINUE;
    END IF;
    PERFORM public._rls_deny_all_client_access(t.relname);
  END LOOP;
END;
$$;

-- ── Public-read tables (preserve existing policies) ──
-- agents: public can read public/core agents
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agents_public_read ON public.agents;
CREATE POLICY agents_public_read ON public.agents
  FOR SELECT TO anon, authenticated
  USING (is_public = true OR is_core = true);
DROP POLICY IF EXISTS agents_no_write_anon ON public.agents;
CREATE POLICY agents_no_write_anon ON public.agents
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS agents_no_write_authenticated ON public.agents;
CREATE POLICY agents_no_write_authenticated ON public.agents
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- user_media: public can read is_public=true media
ALTER TABLE public.user_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_media_public_read ON public.user_media;
CREATE POLICY user_media_public_read ON public.user_media
  FOR SELECT TO anon, authenticated
  USING (is_public = true);
DROP POLICY IF EXISTS user_media_no_write_anon ON public.user_media;
CREATE POLICY user_media_no_write_anon ON public.user_media
  FOR INSERT TO anon WITH CHECK (false);
DROP POLICY IF EXISTS user_media_no_update_anon ON public.user_media;
CREATE POLICY user_media_no_update_anon ON public.user_media
  FOR UPDATE TO anon USING (false);
DROP POLICY IF EXISTS user_media_no_delete_anon ON public.user_media;
CREATE POLICY user_media_no_delete_anon ON public.user_media
  FOR DELETE TO anon USING (false);
DROP POLICY IF EXISTS user_media_no_write_authenticated ON public.user_media;
CREATE POLICY user_media_no_write_authenticated ON public.user_media
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- posts: public feed read
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS posts_public_read ON public.posts;
CREATE POLICY posts_public_read ON public.posts
  FOR SELECT TO anon, authenticated
  USING (true);
DROP POLICY IF EXISTS posts_no_write_anon ON public.posts;
CREATE POLICY posts_no_write_anon ON public.posts
  FOR INSERT TO anon WITH CHECK (false);
DROP POLICY IF EXISTS posts_no_write_authenticated ON public.posts;
CREATE POLICY posts_no_write_authenticated ON public.posts
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- active_tasks: NOT public-read. Contains user input/result/error data.
-- Server-only access via service_role. The deny-all loop above handles it.
-- Explicitly drop the old public-read policy from migration 20260702130000
-- (RLS policies are OR'd, so a lingering allow policy would override the deny).
DROP POLICY IF EXISTS active_tasks_public_read ON public.active_tasks;
DROP POLICY IF EXISTS active_tasks_no_write_anon ON public.active_tasks;
DROP POLICY IF EXISTS active_tasks_no_write_authenticated ON public.active_tasks;

-- ── Verification query ──
-- Lists every table with RLS status and policy count
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  COUNT(p.polname) AS policy_count,
  string_agg(p.polname, ', ' ORDER BY p.polname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
