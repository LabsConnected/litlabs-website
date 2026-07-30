-- Music Lab tables: music_generations, music_tracks, music_provider_jobs
-- Stores generation lifecycle, track metadata, and provider job mappings.
-- Audio files live in R2 (ownership-scoped); only metadata is persisted here.

-- ── music_generations: one per generation request (2 variants per request) ──
CREATE TABLE IF NOT EXISTS public.music_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'mock',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'preparing', 'generating', 'processing', 'completed', 'failed', 'cancelled'
  )),
  original_prompt TEXT NOT NULL,
  structured_blueprint JSONB,
  requested_duration INTEGER NOT NULL DEFAULT 30,
  provider_cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
  lbc_charged INTEGER NOT NULL DEFAULT 0,
  lbc_refunded BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  idempotency_key TEXT NOT NULL,
  output_format TEXT NOT NULL DEFAULT 'mp3',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique idempotency: one generation per (user, idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS music_generations_user_idem_unique
  ON public.music_generations (user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS music_generations_user_id ON public.music_generations(user_id);
CREATE INDEX IF NOT EXISTS music_generations_status ON public.music_generations(status);

ALTER TABLE public.music_generations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS music_generations_deny_anon ON public.music_generations;
CREATE POLICY music_generations_deny_anon ON public.music_generations
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS music_generations_deny_authenticated ON public.music_generations;
CREATE POLICY music_generations_deny_authenticated ON public.music_generations
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── music_tracks: individual generated tracks (2 per generation) ──
CREATE TABLE IF NOT EXISTS public.music_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL REFERENCES public.music_generations(id) ON DELETE CASCADE,
  project_id UUID,
  version_label TEXT NOT NULL DEFAULT 'Version A',
  title TEXT NOT NULL,
  blueprint JSONB,
  audio_storage_key TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0,
  bpm INTEGER,
  musical_key TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  parent_version_id UUID,
  branch_name TEXT,
  lbc_charged INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'mock',
  provider_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_tracks_user_id ON public.music_tracks(user_id);
CREATE INDEX IF NOT EXISTS music_tracks_generation_id ON public.music_tracks(generation_id);
CREATE INDEX IF NOT EXISTS music_tracks_visibility ON public.music_tracks(visibility);

ALTER TABLE public.music_tracks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS music_tracks_deny_anon ON public.music_tracks;
CREATE POLICY music_tracks_deny_anon ON public.music_tracks
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS music_tracks_deny_authenticated ON public.music_tracks;
CREATE POLICY music_tracks_deny_authenticated ON public.music_tracks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── music_provider_jobs: provider job mappings for async polling ──
CREATE TABLE IF NOT EXISTS public.music_provider_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES public.music_generations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_job_id TEXT,
  provider_song_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_provider_jobs_generation_id ON public.music_provider_jobs(generation_id);
CREATE INDEX IF NOT EXISTS music_provider_jobs_provider_job_id ON public.music_provider_jobs(provider_job_id);

ALTER TABLE public.music_provider_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS music_provider_jobs_deny_anon ON public.music_provider_jobs;
CREATE POLICY music_provider_jobs_deny_anon ON public.music_provider_jobs
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS music_provider_jobs_deny_authenticated ON public.music_provider_jobs;
CREATE POLICY music_provider_jobs_deny_authenticated ON public.music_provider_jobs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Updated_at trigger for music_tracks
CREATE OR REPLACE FUNCTION public.update_music_tracks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_music_tracks_updated_at ON public.music_tracks;
CREATE TRIGGER update_music_tracks_updated_at
  BEFORE UPDATE ON public.music_tracks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_music_tracks_updated_at();
