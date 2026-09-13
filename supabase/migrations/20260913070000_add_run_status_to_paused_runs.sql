-- Add async execution tracking columns to agent_paused_runs.
--
-- The approval POST no longer synchronously awaits resumeAgentLoopV2();
-- instead it starts the resumed execution detached from the HTTP request
-- and persists the outcome here so the client can poll for it.
--
-- run_status lifecycle:
--   NULL             — not yet started (approval not yet resolved, or
--                      rejected runs that don't need a resumed execution)
--   'processing'     — resumed execution started, not yet finished
--   'completed'      — resumed execution finished successfully
--   'failed'         — resumed execution threw or returned an error
--
-- Stale-run recovery: if run_started_at is more than RUN_STALE_TIMEOUT_MS
-- ago and run_status is still 'processing', the GET endpoint marks the
-- run as 'failed' with error "Execution timed out (process may have
-- restarted)".

ALTER TABLE agent_paused_runs
  ADD COLUMN IF NOT EXISTS run_status TEXT
    CHECK (run_status IS NULL OR run_status IN ('processing', 'completed', 'failed'));

ALTER TABLE agent_paused_runs
  ADD COLUMN IF NOT EXISTS run_result JSONB;

ALTER TABLE agent_paused_runs
  ADD COLUMN IF NOT EXISTS run_error TEXT;

ALTER TABLE agent_paused_runs
  ADD COLUMN IF NOT EXISTS run_started_at TIMESTAMPTZ;

ALTER TABLE agent_paused_runs
  ADD COLUMN IF NOT EXISTS run_completed_at TIMESTAMPTZ;

-- Index for stale-run recovery queries
CREATE INDEX IF NOT EXISTS idx_agent_paused_runs_run_status
  ON agent_paused_runs (run_status)
  WHERE run_status = 'processing';
