-- ─── billing_reconciliations table ────────────────────────────────
-- Tracks failed refund/settlement operations for retry and audit.
-- Created when reserve_credits succeeds but settlement or refund fails,
-- ensuring no user loses credits silently.

CREATE TABLE IF NOT EXISTS public.billing_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  agent_instance_id TEXT,
  credits_expected INTEGER NOT NULL,
  reason TEXT NOT NULL,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Index for querying pending reconciliations
CREATE INDEX IF NOT EXISTS idx_billing_reconciliations_status
  ON public.billing_reconciliations (status, created_at);

-- Index for finding reconciliations by idempotency key
CREATE INDEX IF NOT EXISTS idx_billing_reconciliations_idempotency
  ON public.billing_reconciliations (idempotency_key);

-- Allow agent_runs status to include 'reconciliation_required'
-- (no constraint change needed if status is TEXT without CHECK constraint;
--  if there is a CHECK constraint, add the new value)
DO $$
BEGIN
  -- Try to add the value to an existing CHECK constraint if present
  BEGIN
    ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_status_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Enable RLS
ALTER TABLE public.billing_reconciliations ENABLE ROW LEVEL SECURITY;

-- Only service role can access reconciliation records
CREATE POLICY "Service role can manage billing_reconciliations"
  ON public.billing_reconciliations
  FOR ALL
  USING (true)
  WITH CHECK (true);
