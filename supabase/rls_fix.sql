-- ============================================
-- RLS Fix for LiTreeLabStudios
-- Run in Supabase Dashboard → SQL Editor → New Query → Run
--
-- WHY: Supabase advisor flags tables with RLS disabled.
-- HOW: Just enable RLS. No extra policies needed.
--
-- All app access goes through Next.js API routes using
-- SUPABASE_SERVICE_ROLE_KEY. The service_role role has
-- bypassrls privilege by design — it works fine with
-- RLS enabled and ZERO policies defined.
--
-- anon/authenticated roles are never used directly
-- from the browser, so no PostgREST policies needed.
-- ============================================

-- Current app tables
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

-- Legacy/orphaned tables from previous schema
ALTER TABLE IF EXISTS public.events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.artifacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jobs       ENABLE ROW LEVEL SECURITY;

-- Verify — should show rowsecurity = true for all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
