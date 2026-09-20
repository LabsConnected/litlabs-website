-- Migration: posts_rls_published_filter
-- Author: LiTT audit fix — 2026-09-20
--
-- Problem: the comprehensive RLS hardening migration (20260826010000) set
-- posts SELECT to USING(true), meaning every row — including unpublished drafts
-- — is readable by anonymous / unauthenticated users.
--
-- Fix: add an `is_published` column (default false). Update the public SELECT
-- policy to only expose published posts. Authors retain full access to their
-- own posts regardless of published state.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;

-- Mark all pre-existing posts as published (they were already USING(true))
UPDATE public.posts
  SET is_published = true
  WHERE is_published = false;

-- Drop every existing SELECT policy on posts (names vary by migration)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'posts'
      AND cmd        = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.posts', pol.policyname);
  END LOOP;
END $$;

-- Anyone (including anon) may read published posts
CREATE POLICY "Public can read published posts"
  ON public.posts
  FOR SELECT
  USING (is_published = true);

-- Authenticated authors always see their own posts (drafts included)
CREATE POLICY "Authors can read their own posts"
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DO $$
DECLARE total_posts INT; published_posts INT;
BEGIN
  SELECT COUNT(*) INTO total_posts FROM public.posts;
  SELECT COUNT(*) INTO published_posts FROM public.posts WHERE is_published = true;
  RAISE NOTICE 'posts migration complete: % total, % published', total_posts, published_posts;
END $$;
