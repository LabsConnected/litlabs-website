-- Close two advisor gaps without changing application query paths.
--
-- 1. Social phase-1 tables (20260916010000_social_phase1.sql)
--    That migration calls public._rls_deny_client_access(), defined in
--    20260702130000_rls_policies_clerk_service_role.sql. The helper only
--    drops and recreates api_deny_anon / api_deny_authenticated. It never
--    runs ENABLE ROW LEVEL SECURITY. The ENABLE fallback in the social
--    migration sits inside EXCEPTION WHEN undefined_function. The helper
--    already exists on any database that replayed earlier migrations, so
--    the fallback never runs. Deny policies are inert while relrowsecurity
--    is false, and the public anon key can read and write these tables
--    through PostgREST.
--
--    Every app read and write of these tables uses getAdminSupabase()
--    (service role), which bypasses RLS. Enabling RLS and keeping the
--    deny-all policies for anon and authenticated matches the original
--    "server-only" comment and leaves those routes working.
--
-- 2. public.usage_daily_summary (20260714030000_usage_stats_schema_fixes.sql)
--    Created with no security_invoker option. PostgreSQL defaults that to
--    false, so the view runs with the owner's rights and bypasses RLS on
--    terminal_command_history, agent_tasks, and agent_runs. No application
--    code selects the view. GET /api/usage/stats reads those base tables
--    with the service-role client. This migration does not rewrite the view
--    query. It switches the view to the querying role and revokes client
--    SELECT. service_role keeps SELECT.
--
-- Idempotent. Do not edit the earlier migrations. Apply on the hosted
-- database only after review; this file does not run itself.

-- ── 1. Social phase-1 tables: RLS on, client roles denied ──
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'post_reposts',
    'post_saves',
    'post_reactions',
    'post_polls',
    'poll_options',
    'poll_votes',
    'comment_likes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS api_deny_anon ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS api_deny_authenticated ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY api_deny_anon ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)',
      t
    );
    EXECUTE format(
      'CREATE POLICY api_deny_authenticated ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)',
      t
    );
  END LOOP;
END $$;

-- ── 2. usage_daily_summary: invoker rights, no client access ──
ALTER VIEW public.usage_daily_summary SET (security_invoker = true);

REVOKE ALL ON TABLE public.usage_daily_summary FROM PUBLIC;
REVOKE ALL ON TABLE public.usage_daily_summary FROM anon;
REVOKE ALL ON TABLE public.usage_daily_summary FROM authenticated;
GRANT SELECT ON TABLE public.usage_daily_summary TO service_role;

-- ── 3. Fail the migration if either fix did not stick ──
DO $$
DECLARE
  missing_rls int;
  deny_policies int;
  invoker text;
BEGIN
  SELECT count(*) INTO missing_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY[
      'post_reposts', 'post_saves', 'post_reactions', 'post_polls',
      'poll_options', 'poll_votes', 'comment_likes'
    ])
    AND c.relrowsecurity IS NOT TRUE;

  IF missing_rls <> 0 THEN
    RAISE EXCEPTION 'RLS still disabled on % social phase-1 table(s)', missing_rls;
  END IF;

  SELECT count(*) INTO deny_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'post_reposts', 'post_saves', 'post_reactions', 'post_polls',
      'poll_options', 'poll_votes', 'comment_likes'
    ])
    AND policyname IN ('api_deny_anon', 'api_deny_authenticated');

  IF deny_policies <> 14 THEN
    RAISE EXCEPTION 'expected 14 client deny policies on social phase-1 tables, found %', deny_policies;
  END IF;

  SELECT opt.option_value INTO invoker
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_options_to_table(c.reloptions) AS opt
  WHERE n.nspname = 'public'
    AND c.relname = 'usage_daily_summary'
    AND c.relkind = 'v'
    AND opt.option_name = 'security_invoker';

  IF invoker IS DISTINCT FROM 'true' AND invoker IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'usage_daily_summary security_invoker is %, expected true', COALESCE(invoker, '<unset>');
  END IF;
END $$;
