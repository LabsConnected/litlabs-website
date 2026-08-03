-- Music Lab — Release 1 vertical slice.
-- Additive only: creates music_* tables. Does NOT alter existing tables,
-- does NOT create a parallel LBC ledger (charges go through credit_ledger
-- via the existing debit_credits / grant_credits RPCs), and does NOT touch
-- the existing public.tracks demo table.
--
-- All FKs reference public.users(id) (Clerk-mapped internal user id), NOT
-- auth.users(id). RLS follows the repo convention: service_role full access,
-- no anon/authenticated policies (all access is server-side via API routes
-- using the service-role client).
--
-- Reversible: DROP the music_* tables in reverse dependency order.

-- ── music_generations: internal job lifecycle ──
CREATE TABLE IF NOT EXISTS public.music_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id UUID,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs', 'mureka', 'mock')),
  provider_model TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'preparing', 'generating', 'processing', 'completed', 'failed', 'cancelled')),
  provider_job_id TEXT,
  provider_song_id TEXT,
  original_prompt TEXT NOT NULL,
  structured_blueprint JSONB NOT NULL,
  requested_duration INTEGER NOT NULL,
  provider_cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
  lbc_charged INTEGER NOT NULL DEFAULT 0,
  lbc_refunded BOOLEAN NOT NULL DEFAULT FALSE,
  failure_code TEXT,
  failure_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  parent_track_id UUID,
  audio_storage_key TEXT,
  output_format TEXT NOT NULL DEFAULT 'mp3',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- One active generation per idempotency key per user.
CREATE UNIQUE INDEX IF NOT EXISTS music_generations_idempotency_unique
  ON public.music_generations (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS music_generations_user_id ON public.music_generations(user_id);
CREATE INDEX IF NOT EXISTS music_generations_status ON public.music_generations(status);
CREATE INDEX IF NOT EXISTS music_generations_active_lookup
  ON public.music_generations(user_id, status)
  WHERE status IN ('queued', 'preparing', 'generating', 'processing');

-- ── music_tracks: finished songs in the vault (>=1 per generation) ──
CREATE TABLE IF NOT EXISTS public.music_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id UUID,
  generation_id UUID NOT NULL REFERENCES public.music_generations(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL DEFAULT 'Version A',
  title TEXT NOT NULL,
  blueprint JSONB NOT NULL,
  audio_storage_key TEXT NOT NULL,
  waveform_peaks JSONB,
  duration INTEGER,
  bpm INTEGER,
  musical_key TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'unlisted', 'public')),
  parent_version_id UUID REFERENCES public.music_tracks(id) ON DELETE SET NULL,
  branch_name TEXT,
  lbc_charged INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  provider_model TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_tracks_user_id ON public.music_tracks(user_id);
CREATE INDEX IF NOT EXISTS music_tracks_generation_id ON public.music_tracks(generation_id);
CREATE INDEX IF NOT EXISTS music_tracks_visibility ON public.music_tracks(visibility);
CREATE INDEX IF NOT EXISTS music_tracks_created_at ON public.music_tracks(created_at DESC);

-- ── music_provider_jobs: external provider job mapping (for async polling) ──
CREATE TABLE IF NOT EXISTS public.music_provider_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES public.music_generations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_job_id TEXT NOT NULL,
  provider_song_id TEXT,
  status TEXT NOT NULL,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_provider_jobs_generation_id ON public.music_provider_jobs(generation_id);
CREATE INDEX IF NOT EXISTS music_provider_jobs_provider_job_id ON public.music_provider_jobs(provider_job_id);

-- ── music_lyrics: lyrics attached to a track ──
CREATE TABLE IF NOT EXISTS public.music_lyrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES public.music_tracks(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL,
  content TEXT NOT NULL,
  sections JSONB,
  is_generated BOOLEAN NOT NULL DEFAULT TRUE,
  explicit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_lyrics_track_id ON public.music_lyrics(track_id);

-- ============================================
-- Row Level Security — service_role only (repo convention)
-- ============================================
ALTER TABLE public.music_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_provider_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_lyrics ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'music_generations', 'music_tracks', 'music_provider_jobs', 'music_lyrics'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY service_role_all_%I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- No anon/authenticated policies: all access is server-side via service_role.
-- Ownership authorization is enforced in the API layer (.eq('user_id', userId)).

-- ── updated_at trigger (reuse existing function if present) ──
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_music_tracks_updated_at ON public.music_tracks;
CREATE TRIGGER update_music_tracks_updated_at
  BEFORE UPDATE ON public.music_tracks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_music_provider_jobs_updated_at ON public.music_provider_jobs;
CREATE TRIGGER update_music_provider_jobs_updated_at
  BEFORE UPDATE ON public.music_provider_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
