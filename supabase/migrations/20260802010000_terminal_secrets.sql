-- Terminal V1: Secret broker — encrypted secret storage
--
-- Stores user-provided secrets (API keys, tokens) encrypted at rest.
-- Secrets are scoped to a user and optionally to a project.
-- The encryption key is server-side only (TERMINAL_SECRET_KEY env var).

CREATE TABLE IF NOT EXISTS terminal_secrets (
  secret_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  project_id TEXT,

  -- Secret metadata
  name TEXT NOT NULL,
  description TEXT,

  -- Encrypted value (AES-256-GCM)
  encrypted_value TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_tag TEXT NOT NULL,

  -- Type for UI display (never the actual value)
  secret_type TEXT NOT NULL DEFAULT 'generic' CHECK (
    secret_type IN ('generic', 'github_token', 'aws_key', 'api_key', 'database_url')
  ),

  -- Scope
  scope TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'project')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT unique_secret_name UNIQUE (user_id, project_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_terminal_secrets_user_id ON terminal_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_secrets_project_id ON terminal_secrets(project_id);

-- RLS: Users can only access their own secrets
ALTER TABLE terminal_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY terminal_secrets_owner_select
  ON terminal_secrets FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY terminal_secrets_owner_insert
  ON terminal_secrets FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY terminal_secrets_owner_update
  ON terminal_secrets FOR UPDATE
  USING (auth.jwt() ->> 'sub' = user_id)
  WITH CHECK (auth.jwt() ->> 'sub' = user_id);

CREATE POLICY terminal_secrets_owner_delete
  ON terminal_secrets FOR DELETE
  USING (auth.jwt() ->> 'sub' = user_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_terminal_secrets_updated_at
  BEFORE UPDATE ON terminal_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_secrets_updated_at();
