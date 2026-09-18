-- Keep approval rows non-terminal until the frozen operation finishes.
ALTER TABLE agent_paused_runs
  DROP CONSTRAINT IF EXISTS agent_paused_runs_status_check;

ALTER TABLE agent_paused_runs
  ADD CONSTRAINT agent_paused_runs_status_check
  CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'rejected', 'expired'));

ALTER TABLE agent_paused_runs
  ADD COLUMN IF NOT EXISTS error TEXT;

DROP INDEX IF EXISTS idx_agent_paused_runs_user_status;
CREATE INDEX IF NOT EXISTS idx_agent_paused_runs_user_status
  ON agent_paused_runs (user_id, status)
  WHERE status IN ('pending', 'executing', 'failed');
