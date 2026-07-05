-- ============================================
-- Advisor Fix for LiTreeLabStudios
-- Fixes all WARN items from: supabase db advisors
-- ============================================

-- ============================================
-- 1) Fix auth_rls_initplan on public.profiles
--    Replace auth.uid() with (select auth.uid())
--    to prevent per-row re-evaluation (performance)
-- ============================================

DROP POLICY IF EXISTS "Profiles - select own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles - update own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles - update own (no admin)" ON public.profiles;

-- Recreate with (select auth.uid()) pattern
CREATE POLICY "Profiles - select own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (select auth.uid()));

CREATE POLICY "Profiles - update own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- ============================================
-- 2) Fix multiple_permissive_policies on profiles
--    Merge the two UPDATE policies into one
--    (removed "Profiles - update own (no admin)"
--     above — single policy covers both cases)
-- ============================================

-- ============================================
-- 3) Fix handle_new_user security definer function
--    Switch to SECURITY INVOKER so it runs as
--    the calling role, not the owner.
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, created_at, updated_at)
  VALUES (new.id, new.email, now(), now())
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ============================================
-- 4) Fix function_search_path_mutable
--    Add SET search_path = '' to all public functions
--    to prevent search_path injection attacks
-- ============================================

CREATE OR REPLACE FUNCTION public.increment_post_likes(post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.posts SET likes_count = likes_count + 1, updated_at = now()
  WHERE id = post_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_post_likes(post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.posts SET likes_count = greatest(0, likes_count - 1), updated_at = now()
  WHERE id = post_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_post_comments(post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.posts SET comments_count = comments_count + 1, updated_at = now()
  WHERE id = post_id;
END;
$$;

-- set_updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

-- ============================================
-- 5) Leaked password protection — enable via dashboard:
--    Authentication > Providers > Email > 
--    "Prevent use of leaked passwords" toggle ON
--    (cannot be set via SQL, dashboard only)
-- ============================================

-- Verify all functions have fixed search_path
SELECT proname, prosecdef, proconfig
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN ('increment_post_likes','decrement_post_likes','increment_post_comments','set_updated_at','handle_new_user')
ORDER BY proname;
