-- ============================================
-- User Facts — provenance-tracked personal context
--
-- Stores learned/confirmed facts about a user with full provenance:
--   - source: where the fact came from (user_explicit, profile, device, connector, conversation)
--   - confidence: how trustworthy the fact is (0.0 - 1.0)
--   - confirmed: whether the user has explicitly confirmed it
--
-- This is SEPARATE from connected data (emails, calendar events) which
-- is read live through connector tools. User facts are permanent
-- personal context that LiTT has learned or been told.
--
-- Examples:
--   key = "preferred_name", value = "Larry", source = "user_explicit", confirmed = true
--   key = "home_location", value = "Spring Lake, MI", source = "user_explicit", confirmed = true
--   key = "ui_preference", value = "dark", source = "conversation", confirmed = false
--   key = "business", value = "LiTTree LabStudios", source = "conversation", confirmed = true
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'conversation'
    CHECK (source IN ('user_explicit', 'profile', 'device', 'connector', 'conversation')),
  confidence REAL NOT NULL DEFAULT 0.5
    CHECK (confidence >= 0.0 AND confidence <= 1.0),
  confirmed BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One fact per key per user — upsert semantics
CREATE UNIQUE INDEX IF NOT EXISTS user_facts_user_key_uniq
  ON public.user_facts (user_id, key);

-- RLS: users can only see/modify their own facts
ALTER TABLE public.user_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_facts_select_own" ON public.user_facts;
CREATE POLICY "user_facts_select_own" ON public.user_facts
  FOR SELECT USING (auth.jwt() ->> 'sub' = user_id);

DROP POLICY IF EXISTS "user_facts_insert_own" ON public.user_facts;
CREATE POLICY "user_facts_insert_own" ON public.user_facts
  FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' = user_id);

DROP POLICY IF EXISTS "user_facts_update_own" ON public.user_facts;
CREATE POLICY "user_facts_update_own" ON public.user_facts
  FOR UPDATE USING (auth.jwt() ->> 'sub' = user_id);

DROP POLICY IF EXISTS "user_facts_delete_own" ON public.user_facts;
CREATE POLICY "user_facts_delete_own" ON public.user_facts
  FOR DELETE USING (auth.jwt() ->> 'sub' = user_id);

-- Service role bypasses RLS (for server-side operations)
-- This is already granted by the supabase_admin role setup.

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS user_facts_user_idx ON public.user_facts (user_id);
CREATE INDEX IF NOT EXISTS user_facts_confirmed_idx ON public.user_facts (user_id, confirmed);

COMMIT;
