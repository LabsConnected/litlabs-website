-- Browser Jobs — async browser automation job queue.
--
-- Supports the Browser Operator lane: Vapi / Studio / Cron enqueue jobs
-- here, a worker picks them up and executes them against a persistent
-- Browserbase + Stagehand session (managed by browser-session-manager.ts).
--
-- Design mirrors agent_work_queue (idempotency, approval, status machine)
-- but uses TEXT user_id (Clerk ID) to match browser_sessions, and adds
-- browser-specific columns (browser_session_id, live_view_url, risk_level,
-- progress tracking).
--
-- Status machine:
--   queued → running → completed | failed | cancelled
--   queued → running → awaiting_approval → approved → running → completed
--   queued → running → awaiting_approval → cancelled

CREATE TABLE IF NOT EXISTS public.browser_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Job identification
  job_type TEXT NOT NULL,                -- e.g. "ghl.workflow.inspect"
  goal TEXT,                              -- human-readable goal
  risk_level TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  requested_by TEXT NOT NULL DEFAULT 'studio'  -- vapi | studio | cron | admin
    CHECK (requested_by IN ('vapi', 'studio', 'cron', 'admin')),

  -- Idempotency — prevents duplicate jobs from retries
  idempotency_key TEXT NOT NULL,

  -- Execution state
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'awaiting_approval', 'approved', 'completed', 'failed', 'cancelled')),

  -- Job parameters (JSON) — type-specific
  params JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Result (JSON) — populated when status = completed
  result JSONB,

  -- Error message — populated when status = failed
  error TEXT,

  -- Progress tracking — { step, totalSteps, steps: [{label, status}] }
  progress JSONB NOT NULL DEFAULT '{"step":0,"totalSteps":0,"steps":[]}'::jsonb,

  -- Associated browser session (FK to browser_sessions)
  browser_session_id UUID REFERENCES public.browser_sessions(id) ON DELETE SET NULL,

  -- Live view URL (from Browserbase session, for embedding in Studio)
  live_view_url TEXT,

  -- Approval tracking
  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  -- Retry tracking
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique idempotency key prevents duplicate jobs
CREATE UNIQUE INDEX IF NOT EXISTS idx_browser_jobs_idempotency
  ON public.browser_jobs(idempotency_key);

-- Index for finding queued jobs (worker claims)
CREATE INDEX IF NOT EXISTS idx_browser_jobs_queued
  ON public.browser_jobs(status, created_at)
  WHERE status = 'queued';

-- Index for user's jobs
CREATE INDEX IF NOT EXISTS idx_browser_jobs_user
  ON public.browser_jobs(user_id, created_at DESC);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_browser_jobs_status
  ON public.browser_jobs(status);

-- Index for awaiting_approval jobs
CREATE INDEX IF NOT EXISTS idx_browser_jobs_approval
  ON public.browser_jobs(user_id, status)
  WHERE status = 'awaiting_approval';

ALTER TABLE public.browser_jobs ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API routes with supabaseAdmin)
DROP POLICY IF EXISTS service_role_all_browser_jobs ON public.browser_jobs;
CREATE POLICY service_role_all_browser_jobs ON public.browser_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Users can read their own jobs (via Clerk auth.uid() — user_id is Clerk ID)
DROP POLICY IF EXISTS users_read_own_browser_jobs ON public.browser_jobs;
CREATE POLICY users_read_own_browser_jobs ON public.browser_jobs
  FOR SELECT USING (auth.uid()::text = user_id);

-- Users can insert their own jobs
DROP POLICY IF EXISTS users_insert_own_browser_jobs ON public.browser_jobs;
CREATE POLICY users_insert_own_browser_jobs ON public.browser_jobs
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Users can update their own jobs
DROP POLICY IF EXISTS users_update_own_browser_jobs ON public.browser_jobs;
CREATE POLICY users_update_own_browser_jobs ON public.browser_jobs
  FOR UPDATE USING (auth.uid()::text = user_id);
