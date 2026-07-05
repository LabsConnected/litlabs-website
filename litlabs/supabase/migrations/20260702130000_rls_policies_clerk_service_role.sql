-- ============================================
-- RLS policies: Clerk + service_role architecture
-- Run in Supabase SQL Editor (safe to re-run)
--
-- HOW THIS APP WORKS:
--   • Users authenticate via Clerk (not Supabase Auth)
--   • Next.js API routes verify Clerk, then use SUPABASE_SERVICE_ROLE_KEY
--   • service_role bypasses RLS — policies below are for advisor compliance
--     and to block direct PostgREST access via anon/authenticated keys
--
-- DO NOT use auth.uid() policies — Clerk IDs are not in auth.uid()
-- ============================================

-- Helper: deny direct client access for a table
CREATE OR REPLACE FUNCTION public._rls_deny_client_access(table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS api_deny_anon ON public.%I', table_name);
  EXECUTE format('DROP POLICY IF EXISTS api_deny_authenticated ON public.%I', table_name);
  EXECUTE format(
    'CREATE POLICY api_deny_anon ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)',
    table_name
  );
  EXECUTE format(
    'CREATE POLICY api_deny_authenticated ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)',
    table_name
  );
END;
$$;

-- ── Priority tables (wallets, creator, conversations) ──
SELECT public._rls_deny_client_access('wallets');
SELECT public._rls_deny_client_access('transactions');
SELECT public._rls_deny_client_access('creator_earnings');
SELECT public._rls_deny_client_access('conversations');
SELECT public._rls_deny_client_access('conversation_messages');

-- ── Other advisor-flagged tables ──
SELECT public._rls_deny_client_access('user_agents');
SELECT public._rls_deny_client_access('user_preferences');
SELECT public._rls_deny_client_access('agent_sessions');
SELECT public._rls_deny_client_access('cli_sessions');

-- ── Core app tables (same pattern) ──
SELECT public._rls_deny_client_access('users');
SELECT public._rls_deny_client_access('subscriptions');
SELECT public._rls_deny_client_access('posts');
SELECT public._rls_deny_client_access('post_likes');
SELECT public._rls_deny_client_access('post_comments');
SELECT public._rls_deny_client_access('orchestration_jobs');
SELECT public._rls_deny_client_access('rate_limit_store');
SELECT public._rls_deny_client_access('deployments');
SELECT public._rls_deny_client_access('invite_codes');
SELECT public._rls_deny_client_access('invite_redemptions');
SELECT public._rls_deny_client_access('api_keys');
SELECT public._rls_deny_client_access('api_key_usage');

-- ── Public catalog: allow read-only for anon (optional marketplace browsing) ──
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agents_public_read ON public.agents;
CREATE POLICY agents_public_read ON public.agents
  FOR SELECT TO anon, authenticated
  USING (is_public = true OR is_core = true);

DROP POLICY IF EXISTS agents_no_write_anon ON public.agents;
CREATE POLICY agents_no_write_anon ON public.agents
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- ── Public gallery media ──
ALTER TABLE public.user_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_media_public_read ON public.user_media;
CREATE POLICY user_media_public_read ON public.user_media
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

DROP POLICY IF EXISTS user_media_no_write_anon ON public.user_media;
CREATE POLICY user_media_no_write_anon ON public.user_media
  FOR INSERT TO anon WITH CHECK (false);
CREATE POLICY user_media_no_update_anon ON public.user_media
  FOR UPDATE TO anon USING (false);
CREATE POLICY user_media_no_delete_anon ON public.user_media
  FOR DELETE TO anon USING (false);

-- ── Public posts feed read ──
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS posts_public_read ON public.posts;
CREATE POLICY posts_public_read ON public.posts
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS posts_no_write_anon ON public.posts;
CREATE POLICY posts_no_write_anon ON public.posts
  FOR INSERT TO anon WITH CHECK (false);

-- ── Active tasks: read-only public status board ──
ALTER TABLE public.active_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS active_tasks_public_read ON public.active_tasks;
CREATE POLICY active_tasks_public_read ON public.active_tasks
  FOR SELECT TO anon, authenticated
  USING (true);
DROP POLICY IF EXISTS active_tasks_no_write_anon ON public.active_tasks;
CREATE POLICY active_tasks_no_write_anon ON public.active_tasks
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- ── Harden SECURITY DEFINER tier/plan functions (if present) ──
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'get_user_plan', 'is_admin_user', 'is_pro_user',
        'is_elite_user', 'is_starter_user', 'upgrade_user_plan'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END;
$$;

-- Cleanup helper (optional — keep if you want to reuse)
-- DROP FUNCTION IF EXISTS public._rls_deny_client_access(text);

-- Verify: list tables with RLS on and policy count
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  COUNT(p.polname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = true
GROUP BY c.relname, c.relrowsecurity
ORDER BY policy_count ASC, c.relname;
