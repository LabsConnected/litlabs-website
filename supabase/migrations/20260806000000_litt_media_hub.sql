-- LiTT Media Hub — playback history and playlists tables.
--
-- Supports the extended media player with cross-provider history
-- and user-created playlists.

-- ─── media_playback_history ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_playback_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  creator TEXT,
  artwork_url TEXT,
  duration_ms BIGINT,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_history_user_id
  ON public.media_playback_history(user_id);
CREATE INDEX IF NOT EXISTS idx_media_history_played_at
  ON public.media_playback_history(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_history_provider
  ON public.media_playback_history(provider);

-- ─── media_playlists ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_playlists_user_id
  ON public.media_playlists(user_id);

-- ─── active_project (unified project context) ────────────────────
-- Replaces the split localStorage keys used by Dashboard and Studio.
-- The active project is now server-authoritative.
CREATE TABLE IF NOT EXISTS public.user_active_project (
  user_id TEXT PRIMARY KEY,
  project_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
);

-- ─── RLS Policies ────────────────────────────────────────────────
ALTER TABLE public.media_playback_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_active_project ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own media history" ON public.media_playback_history;
CREATE POLICY "Users can manage their own media history"
  ON public.media_playback_history
  FOR ALL
  USING (user_id = auth.uid()::text OR user_id = current_setting('request.jwt.claims', true)::json->>'sub');

DROP POLICY IF EXISTS "Users can manage their own playlists" ON public.media_playlists;
CREATE POLICY "Users can manage their own playlists"
  ON public.media_playlists
  FOR ALL
  USING (user_id = auth.uid()::text OR user_id = current_setting('request.jwt.claims', true)::json->>'sub');

DROP POLICY IF EXISTS "Users can manage their own active project" ON public.user_active_project;
CREATE POLICY "Users can manage their own active project"
  ON public.user_active_project
  FOR ALL
  USING (user_id = auth.uid()::text OR user_id = current_setting('request.jwt.claims', true)::json->>'sub');
