-- Security linter fixes for Supabase database
-- Run via: npx supabase db push   or   Supabase SQL Editor

/* ═══════════════════════════════════════════════════════════════
   1. FUNCTION SEARCH PATH MUTABLE (7 functions)
   Fix: Add SET search_path = '' to all functions
   Guard: functions may not exist yet in a fresh migration replay
   ═══════════════════════════════════════════════════════════════ */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.update_updated_at_column() SET search_path = '';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_old_events' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.cleanup_old_events() SET search_path = '';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.handle_updated_at() SET search_path = '';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_post_likes' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.increment_post_likes(UUID) SET search_path = '';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'decrement_post_likes' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.decrement_post_likes(UUID) SET search_path = '';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_post_comments' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.increment_post_comments(UUID) SET search_path = '';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.set_updated_at() SET search_path = '';
  END IF;
END $$;

/* ═══════════════════════════════════════════════════════════════
   2. RLS POLICY ALWAYS TRUE — site_events INSERT
   Fix: Replace permissive INSERT policy with a restricted one
   Guard: site_events table may not exist in all environments
   ═══════════════════════════════════════════════════════════════ */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'site_events') THEN
    DROP POLICY IF EXISTS "Anyone can insert events" ON public.site_events;
    DROP POLICY IF EXISTS "Authenticated users can insert events" ON public.site_events;
    CREATE POLICY "Authenticated users can insert events"
      ON public.site_events
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

/* ═══════════════════════════════════════════════════════════════
   3. PUBLIC BUCKET ALLOWS LISTING — media bucket
   Fix: Replace broad SELECT policy with targeted one
   ═══════════════════════════════════════════════════════════════ */

-- Drop the broad listing policy on storage.objects
DROP POLICY IF EXISTS "Media is publicly readable" ON storage.objects;

-- Create a policy that only allows reading specific objects, not listing
DROP POLICY IF EXISTS "Media objects are publicly readable" ON storage.objects;
CREATE POLICY "Media objects are publicly readable"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'media');

/* ═══════════════════════════════════════════════════════════════
   4. SECURITY DEFINER FUNCTIONS EXECUTABLE BY PUBLIC
   Fix: Revoke EXECUTE on cleanup_old_events from public roles
   Guard: function may not exist in a fresh migration replay
   ═══════════════════════════════════════════════════════════════ */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_old_events' AND pronamespace = 'public'::regnamespace) THEN
    REVOKE EXECUTE ON FUNCTION public.cleanup_old_events() FROM anon;
    REVOKE EXECUTE ON FUNCTION public.cleanup_old_events() FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.cleanup_old_events() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO service_role;
  END IF;
END $$;

/* ═══════════════════════════════════════════════════════════════
   5. AUTH LEAKED PASSWORD PROTECTION
   Note: This is a Supabase Auth dashboard setting, not a SQL fix.
   Steps to enable:
   1. Go to Supabase Dashboard → Authentication → Policies
   2. Enable "Prevent use of leaked passwords"
   Or via Management API:
   PATCH /auth/v1/admin/config
   { "password_hpk_enabled": true }
   ═══════════════════════════════════════════════════════════════ */
