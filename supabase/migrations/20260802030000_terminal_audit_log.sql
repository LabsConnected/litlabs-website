-- Terminal V1: Audit log — tracks all terminal actions for security
--
-- Records every sandbox lifecycle event, terminal connection, and
-- administrative action for audit and compliance purposes.

CREATE TABLE IF NOT EXISTS terminal_audit_log (
  audit_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  sandbox_id TEXT,

  -- Action type
  action TEXT NOT NULL CHECK (
    action IN (
      'sandbox.create', 'sandbox.start', 'sandbox.stop', 'sandbox.destroy',
      'terminal.connect', 'terminal.disconnect', 'terminal.resize',
      'command.execute', 'preview.expose', 'preview.close',
      'workspace.create', 'workspace.delete', 'workspace.restore',
      'secret.create', 'secret.delete', 'secret.resolve',
      'quota.exceeded'
    )
  ),

  -- Additional context (JSON, never contains secret values)
  details JSONB,

  -- IP address for audit trail
  ip_address TEXT,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_terminal_audit_user_id ON terminal_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_audit_action ON terminal_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_terminal_audit_sandbox_id ON terminal_audit_log(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_terminal_audit_created_at ON terminal_audit_log(created_at DESC);

-- RLS: Users can only see their own audit entries
ALTER TABLE terminal_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terminal_audit_owner_select ON terminal_audit_log;
CREATE POLICY terminal_audit_owner_select
  ON terminal_audit_log FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);

-- Only service role can insert (internal logging)
-- Service role bypasses RLS
