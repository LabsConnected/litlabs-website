-- Terminal V1: Persistent workspace system
--
-- This migration creates the terminal_workspaces table that replaces
-- the in-memory Map and .workspaces.json file from the legacy system.
--
-- Workspaces are the persistent storage layer. Sandboxes are ephemeral
-- compute instances that mount a workspace's persistent volume.

CREATE TABLE IF NOT EXISTS terminal_workspaces (
  workspace_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sandbox_provider TEXT NOT NULL DEFAULT 'managed-sandbox',
  current_sandbox_id TEXT,
  storage_volume_id TEXT,

  -- Git source
  git_source TEXT NOT NULL DEFAULT 'blank' CHECK (git_source IN ('github', 'blank')),
  git_owner TEXT,
  git_repo TEXT,
  git_branch TEXT,
  last_commit_sha TEXT,

  -- State
  state TEXT NOT NULL DEFAULT 'initial' CHECK (
    state IN ('initial', 'cloning', 'ready', 'error', 'deleted')
  ),
  failure_reason TEXT,

  -- Storage usage (updated periodically)
  storage_usage_bytes BIGINT NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT unique_user_project UNIQUE (user_id, project_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_terminal_workspaces_user_id ON terminal_workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_workspaces_project_id ON terminal_workspaces(project_id);
CREATE INDEX IF NOT EXISTS idx_terminal_workspaces_state ON terminal_workspaces(state);
CREATE INDEX IF NOT EXISTS idx_terminal_workspaces_last_active ON terminal_workspaces(last_active_at);

-- RLS: Users can only access their own workspaces
ALTER TABLE terminal_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY terminal_workspaces_owner_select
  ON terminal_workspaces FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY terminal_workspaces_owner_insert
  ON terminal_workspaces FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY terminal_workspaces_owner_update
  ON terminal_workspaces FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id)
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY terminal_workspaces_owner_delete
  ON terminal_workspaces FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);

-- Service role bypasses RLS (for internal service-to-service calls)
-- This is handled by using the service role client in terminal-internal-client.ts

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_workspaces_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_terminal_workspaces_updated_at
  BEFORE UPDATE ON terminal_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_workspaces_updated_at();
