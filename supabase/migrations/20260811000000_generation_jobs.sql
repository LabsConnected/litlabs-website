-- Generation Jobs — canonical job table for all media generation.
--
-- One row per generation attempt (image, video, music, speech).
-- Replaces the in-memory video job store and provides durable,
-- queryable job history with idempotency, billing, and asset tracking.
--
-- Idempotency: (user_id, request_id) is unique. Retries with the
-- same request_id return the existing job instead of creating a new one.

CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- What was generated
  modality TEXT NOT NULL CHECK (modality IN ('image', 'video', 'music', 'speech')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,

  -- Idempotency: same request_id = same job
  request_id TEXT NOT NULL,

  -- Provider tracking
  provider_job_id TEXT,

  -- Billing
  actual_provider_cost_cents INTEGER,
  littbits_charged INTEGER NOT NULL DEFAULT 0,
  refund_status TEXT NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'pending', 'refunded', 'failed')),

  -- Result
  asset_id TEXT,
  error TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'generating', 'processing', 'persisting', 'completed', 'failed', 'cancelled'
  )),

  -- Metadata (resolution, duration, aspect ratio, etc.)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Idempotency: one job per (user_id, request_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_jobs_user_request
  ON public.generation_jobs(user_id, request_id);

-- Query: user's recent jobs
CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_created
  ON public.generation_jobs(user_id, created_at DESC);

-- Query: jobs by status (for worker queues)
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status
  ON public.generation_jobs(status, created_at);

-- Query: jobs by provider (for cost analysis)
CREATE INDEX IF NOT EXISTS idx_generation_jobs_provider
  ON public.generation_jobs(provider, created_at);

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API routes with supabaseAdmin)
DROP POLICY IF EXISTS service_role_all_generation_jobs ON public.generation_jobs;
CREATE POLICY service_role_all_generation_jobs ON public.generation_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Users can read their own jobs
DROP POLICY IF EXISTS users_read_own_generation_jobs ON public.generation_jobs;
CREATE POLICY users_read_own_generation_jobs ON public.generation_jobs
  FOR SELECT USING (user_id = auth.uid()::text::uuid);
