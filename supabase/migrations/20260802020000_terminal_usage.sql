-- Terminal V1: Usage quotas and billing
--
-- Tracks per-user terminal usage for quota enforcement and billing.
-- Includes concurrent sandbox limits, monthly hour limits, and
-- storage usage tracking.

CREATE TABLE IF NOT EXISTS terminal_usage (
  usage_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,

  -- Billing period (YYYY-MM)
  billing_period TEXT NOT NULL,

  -- Usage counters
  sandbox_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  storage_gb_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  preview_port_hours NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Concurrent sandbox tracking
  max_concurrent_sandboxes INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_user_period UNIQUE (user_id, billing_period)
);

CREATE INDEX IF NOT EXISTS idx_terminal_usage_user_id ON terminal_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_usage_period ON terminal_usage(billing_period);

-- RLS
ALTER TABLE terminal_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY terminal_usage_owner_select
  ON terminal_usage FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);

-- Service role bypasses RLS for internal quota checks

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_terminal_usage_updated_at
  BEFORE UPDATE ON terminal_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_usage_updated_at();
