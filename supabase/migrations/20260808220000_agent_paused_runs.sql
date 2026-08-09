-- Agent Paused Runs — server-side persistence for V2 agent loop runs
-- that paused for ACT-mode approval.
--
-- Security properties:
-- - Approvals are single-use: status transitions from "pending" to
--   "approved"/"rejected"/"expired" only. No re-resolution possible.
-- - Approvals expire after 5 minutes (TTL enforced in application layer).
-- - Tool arguments (inputs) are frozen at pause time.
-- - User ownership is enforced via RLS and application-level checks.

CREATE TABLE IF NOT EXISTS agent_paused_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  paused_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  execution_mode TEXT NOT NULL DEFAULT 'act',
  system_prompt TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  resolved_at TIMESTAMPTZ
);

-- Row Level Security: users can only see their own paused runs
ALTER TABLE agent_paused_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_paused_runs_owner_select
  ON agent_paused_runs
  FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY agent_paused_runs_owner_insert
  ON agent_paused_runs
  FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY agent_paused_runs_owner_update
  ON agent_paused_runs
  FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id)
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_agent_paused_runs_user_status
  ON agent_paused_runs (user_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_paused_runs_conversation
  ON agent_paused_runs (conversation_id);

CREATE INDEX IF NOT EXISTS idx_agent_paused_runs_expires
  ON agent_paused_runs (expires_at)
  WHERE status = 'pending';
