-- ============================================
-- RLS Security Fix for LiTreeLabStudios
-- Run in Supabase Dashboard → SQL Editor → New Query → Run
--
-- WHY: Supabase advisor flags tables with RLS disabled.
-- HOW: Enable RLS on all tables, then add a permissive
--      service_role bypass so our Next.js API routes
--      (which use the service role key) still work 100%.
--
-- The service role key ALREADY bypasses RLS, so these
-- policies are just for belt-and-suspenders hardening
-- and to silence the security advisor.
-- ============================================

-- ============================================
-- 1) ENABLE RLS on all current app tables
-- ============================================
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_agents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_media           ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2) ENABLE RLS on legacy/orphaned tables
--    (these exist from a previous schema but
--     are not used by the current app)
-- ============================================
ALTER TABLE IF EXISTS public.events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.artifacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jobs       ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3) SERVICE ROLE BYPASS POLICIES
--    The Next.js API (service_role key) must
--    still read/write everything freely.
--    service_role already bypasses RLS, but
--    these make the intent explicit.
-- ============================================

-- users
DROP POLICY IF EXISTS "service_role_all_users" ON public.users;
CREATE POLICY "service_role_all_users" ON public.users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_preferences
DROP POLICY IF EXISTS "service_role_all_prefs" ON public.user_preferences;
CREATE POLICY "service_role_all_prefs" ON public.user_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_agents
DROP POLICY IF EXISTS "service_role_all_user_agents" ON public.user_agents;
CREATE POLICY "service_role_all_user_agents" ON public.user_agents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- subscriptions
DROP POLICY IF EXISTS "service_role_all_subscriptions" ON public.subscriptions;
CREATE POLICY "service_role_all_subscriptions" ON public.subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- wallets
DROP POLICY IF EXISTS "service_role_all_wallets" ON public.wallets;
CREATE POLICY "service_role_all_wallets" ON public.wallets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- transactions
DROP POLICY IF EXISTS "service_role_all_transactions" ON public.transactions;
CREATE POLICY "service_role_all_transactions" ON public.transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- posts
DROP POLICY IF EXISTS "service_role_all_posts" ON public.posts;
CREATE POLICY "service_role_all_posts" ON public.posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- post_likes
DROP POLICY IF EXISTS "service_role_all_post_likes" ON public.post_likes;
CREATE POLICY "service_role_all_post_likes" ON public.post_likes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- post_comments
DROP POLICY IF EXISTS "service_role_all_post_comments" ON public.post_comments;
CREATE POLICY "service_role_all_post_comments" ON public.post_comments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_media
DROP POLICY IF EXISTS "service_role_all_user_media" ON public.user_media;
CREATE POLICY "service_role_all_user_media" ON public.user_media
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- events (legacy)
DROP POLICY IF EXISTS "service_role_all_events" ON public.events;
CREATE POLICY "service_role_all_events" ON public.events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 4) ANON ROLE — block all access by default
--    The app never uses anon key for data.
--    (No policies = no access for anon — correct)
-- ============================================

-- ============================================
-- 5) VERIFY — run this to confirm RLS is ON
-- ============================================
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
