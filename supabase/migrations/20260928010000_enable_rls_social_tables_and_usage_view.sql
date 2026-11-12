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
-- 3. Counter RPCs in the same social migration are SECURITY DEFINER and
--    were created without REVOKE EXECUTE. PostgreSQL grants EXECUTE to
--    PUBLIC by default (proacl stays null), so anon and authenticated can
--    call them through PostgREST and change counters. Each signature is
--    a single uuid argument. App routes call them only via getAdminSupabase().
--    search_path is already '' (stored as search_path=""). Bodies are
--    schema-qualified. This migration pins search_path to '' only when
--    that setting is missing, then revokes client execute and grants
--    service_role. The other functions in the social migrations
--    (set_updated_at, notify_on_follow) are not SECURITY DEFINER.
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

-- ── 3. Counter RPCs: service_role only ──
-- Signatures match 20260916010000_social_phase1.sql exactly.
-- search_path is already '' on each function. Pin it only when that
-- setting is missing. Do not rewrite the function bodies.
DO $$
DECLARE
  sig text;
  fn regprocedure;
  cfg text[];
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.increment_post_reposts(uuid)',
    'public.decrement_post_reposts(uuid)',
    'public.increment_post_saves(uuid)',
    'public.decrement_post_saves(uuid)',
    'public.increment_post_shares(uuid)',
    'public.increment_poll_option_votes(uuid)',
    'public.increment_comment_likes(uuid)',
    'public.decrement_comment_likes(uuid)'
  ]
  LOOP
    fn := sig::regprocedure;
    SELECT p.proconfig INTO cfg FROM pg_proc p WHERE p.oid = fn;
    IF cfg IS NULL OR NOT (cfg @> ARRAY['search_path=""']::text[]) THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = %L', sig, '');
    END IF;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.increment_post_reposts(post_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_reposts(post_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.decrement_post_reposts(post_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_post_reposts(post_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_post_saves(post_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_saves(post_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.decrement_post_saves(post_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_post_saves(post_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_post_shares(post_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_post_shares(post_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_poll_option_votes(option_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_poll_option_votes(option_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_comment_likes(comment_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_comment_likes(comment_id uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.decrement_comment_likes(comment_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_comment_likes(comment_id uuid) TO service_role;

-- ── 4. Fail the migration if any fix did not stick ──
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

DO $$
DECLARE
  sig text;
  fn regprocedure;
  cfg text[];
  acl aclitem[];
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.increment_post_reposts(uuid)',
    'public.decrement_post_reposts(uuid)',
    'public.increment_post_saves(uuid)',
    'public.decrement_post_saves(uuid)',
    'public.increment_post_shares(uuid)',
    'public.increment_poll_option_votes(uuid)',
    'public.increment_comment_likes(uuid)',
    'public.decrement_comment_likes(uuid)'
  ]
  LOOP
    fn := sig::regprocedure;
    SELECT p.proconfig, p.proacl INTO cfg, acl FROM pg_proc p WHERE p.oid = fn;

    IF NOT (cfg @> ARRAY['search_path=""']::text[]) THEN
      RAISE EXCEPTION '% search_path is %, expected empty', sig, COALESCE(cfg::text, '<unset>');
    END IF;
    IF acl IS NULL OR EXISTS (
      SELECT 1 FROM aclexplode(acl) AS a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC can still execute %', sig;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can still execute %', sig;
    END IF;
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can still execute %', sig;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %', sig;
    END IF;
  END LOOP;
END $$;
