-- ============================================================
-- FIX SOCIAL SCHEMA MISMATCHES
-- Run this in Supabase SQL Editor to align with existing API code
-- ============================================================

-- 1. FIX FOLLOWS TABLE: rename following_id → followee_id (matches existing API)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'follows' AND column_name = 'following_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'follows' AND column_name = 'followee_id'
  ) THEN
    ALTER TABLE public.follows RENAME COLUMN following_id TO followee_id;
  END IF;
END $$;

-- Also rename the FK constraint if it exists
ALTER TABLE public.follows
  DROP CONSTRAINT IF EXISTS follows_following_id_fkey;

-- Add followee_id FK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'follows_followee_id_fkey'
      AND table_name = 'follows'
  ) THEN
    ALTER TABLE public.follows
      ADD CONSTRAINT follows_followee_id_fkey
      FOREIGN KEY (followee_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure follower_id FK exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'follows_follower_id_fkey'
      AND table_name = 'follows'
  ) THEN
    ALTER TABLE public.follows
      ADD CONSTRAINT follows_follower_id_fkey
      FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update RLS policies to use followee_id
DROP POLICY IF EXISTS "follows_insert" ON public.follows;
CREATE POLICY "follows_insert" ON public.follows FOR INSERT WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "follows_delete" ON public.follows;
CREATE POLICY "follows_delete" ON public.follows FOR DELETE USING (auth.uid() = follower_id);

-- 2. FIX NOTIFICATIONS TABLE: add missing columns to match existing API
-- Existing API uses: recipient_id, actor_id, type, entity_type, entity_id, content
-- Migration created: user_id, actor_id, type, title, message, read, post_id

DO $$
BEGIN
  -- Rename user_id → recipient_id if user_id exists and recipient_id doesn't
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'recipient_id'
  ) THEN
    ALTER TABLE public.notifications RENAME COLUMN user_id TO recipient_id;
  END IF;

  -- Add missing columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN entity_type text DEFAULT 'post';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN entity_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'content'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN content text;
  END IF;

  -- Drop title/message if they exist (API uses content instead)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'title'
  ) THEN
    ALTER TABLE public.notifications DROP COLUMN title;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'message'
  ) THEN
    ALTER TABLE public.notifications DROP COLUMN message;
  END IF;
END $$;

-- Ensure notifications RLS policies use recipient_id
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications FOR SELECT USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
CREATE POLICY "notifications_delete" ON public.notifications FOR DELETE USING (auth.uid() = recipient_id);

-- 3. FIX POSTS TABLE: ensure likes_count and comments_count exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'likes_count'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN likes_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'comments_count'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN comments_count integer DEFAULT 0;
  END IF;
END $$;

-- 4. VERIFY
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('follows', 'notifications', 'posts', 'post_likes', 'post_comments')
ORDER BY table_name, ordinal_position;
