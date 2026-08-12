-- Browser Job Events — granular event stream for live Studio observation.
--
-- Each event represents one observable moment in a browser job's execution:
--   job.started, step.started, observation, action, verification,
--   step.completed, retry, approval.required, job.completed, job.failed
--
-- The Studio panel subscribes via SSE (GET /api/browser/jobs/:id/events)
-- and renders the activity log in real time.
--
-- Events are append-only and never deleted. They form an audit trail.

CREATE TABLE IF NOT EXISTS public.browser_job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.browser_jobs(id) ON DELETE CASCADE,

  -- Event type — controls how the Studio panel renders it
  type TEXT NOT NULL CHECK (type IN (
    'job.started',
    'step.started',
    'observation',
    'action',
    'verification',
    'step.completed',
    'retry',
    'approval.required',
    'job.completed',
    'job.failed'
  )),

  -- Step index (0-based) for step-scoped events
  step INTEGER,

  -- Human-readable message shown in the activity log
  message TEXT NOT NULL,

  -- Structured metadata (screenshots, selectors, URLs, verification results, etc.)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for SSE polling: events for a job, in order
CREATE INDEX IF NOT EXISTS idx_browser_job_events_job
  ON public.browser_job_events(job_id, created_at);

-- Index for "events since cursor" queries
CREATE INDEX IF NOT EXISTS idx_browser_job_events_job_created
  ON public.browser_job_events(job_id, created_at DESC);

ALTER TABLE public.browser_job_events ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API routes with supabaseAdmin)
DROP POLICY IF EXISTS service_role_all_browser_job_events ON public.browser_job_events;
CREATE POLICY service_role_all_browser_job_events ON public.browser_job_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Users can read events for their own jobs (join through browser_jobs)
DROP POLICY IF EXISTS users_read_own_browser_job_events ON public.browser_job_events;
CREATE POLICY users_read_own_browser_job_events ON public.browser_job_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.browser_jobs bj
      WHERE bj.id = browser_job_events.job_id
        AND bj.user_id = auth.uid()::text
    )
  );
