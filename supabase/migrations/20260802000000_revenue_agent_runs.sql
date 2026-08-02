-- ============================================
-- Revenue Agent Runs — canonical execution lifecycle
-- for paid marketplace agents.
--
-- This is separate from the legacy agent_runs table
-- (which is a simple queue tracker). Revenue agent runs
-- have a full lifecycle state machine, approval gates,
-- usage ledger integration, and deployment tracking.
-- ============================================

BEGIN;

-- ─── Revenue agent runs ─────────────────────────────────────────
-- A revenue agent run is a single execution of a paid marketplace
-- agent against a user-owned project. Every run is:
--   - authenticated (user_id from Clerk)
--   - entitlement-verified (agent_entitlements.status = 'active')
--   - project-owned (studio_projects.user_id = caller)
--   - idempotent (client_request_id unique per user)
--   - tool-restricted (allowed_tools from agent capability manifest)
--   - rate-limited (max concurrent + daily runs)

CREATE TABLE IF NOT EXISTS public.revenue_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  user_id text NOT NULL,
  agent_id uuid NOT NULL,
  agent_version_id uuid NOT NULL,
  project_id uuid NOT NULL,

  -- Idempotency
  client_request_id text NOT NULL,

  -- Lifecycle
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued',
      'planning',
      'awaiting_approval',
      'executing',
      'previewing',
      'awaiting_deploy_approval',
      'deploying',
      'completed',
      'failed',
      'cancelled'
    )),

  -- Input
  prompt text NOT NULL,

  -- Tool restriction (server-resolved from agent capability manifest)
  allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Plan (produced during 'planning' phase)
  plan jsonb,

  -- Execution results
  files_changed jsonb DEFAULT '[]'::jsonb,
  validation_result jsonb,
  preview_url text,
  preview_status text,

  -- Deployment results
  deployment_id text,
  deployment_url text,
  deployment_status text,
  deployment_provider text,
  deployment_error text,

  -- Checkpoint reference (for rollback)
  checkpoint_id uuid,

  -- Error tracking
  error_code text,
  error_message text,
  error_details jsonb,

  -- Usage
  usage_ledger_entry_id text,

  -- Timestamps
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: one run per (user_id, client_request_id)
CREATE UNIQUE INDEX IF NOT EXISTS revenue_agent_runs_user_client_req_uniq
  ON public.revenue_agent_runs (user_id, client_request_id);

-- Lookups
CREATE INDEX IF NOT EXISTS revenue_agent_runs_user_id_idx
  ON public.revenue_agent_runs (user_id);
CREATE INDEX IF NOT EXISTS revenue_agent_runs_agent_id_idx
  ON public.revenue_agent_runs (agent_id);
CREATE INDEX IF NOT EXISTS revenue_agent_runs_project_id_idx
  ON public.revenue_agent_runs (project_id);
CREATE INDEX IF NOT EXISTS revenue_agent_runs_status_idx
  ON public.revenue_agent_runs (status);
CREATE INDEX IF NOT EXISTS revenue_agent_runs_created_at_idx
  ON public.revenue_agent_runs (queued_at DESC);

-- ─── Revenue agent run approvals ────────────────────────────────
-- Server-enforced approval gates. A run in 'awaiting_approval' or
-- 'awaiting_deploy_approval' must have a pending approval record.
-- The browser cannot skip approvals — the run state machine
-- enforces them server-side.

CREATE TABLE IF NOT EXISTS public.revenue_agent_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.revenue_agent_runs(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  approval_type text NOT NULL
    CHECK (approval_type IN ('plan', 'deploy')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  -- The plan or deployment summary that was presented for approval
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Who approved/rejected (always the user, never the agent)
  resolved_by text,
  resolved_at timestamptz,
  -- Rejection reason (if rejected)
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenue_agent_approvals_run_id_idx
  ON public.revenue_agent_approvals (run_id);
CREATE INDEX IF NOT EXISTS revenue_agent_approvals_status_idx
  ON public.revenue_agent_approvals (status);

-- ─── Revenue agent run events ───────────────────────────────────
-- Append-only event log for audit trail. Every state transition
-- and tool invocation is recorded here.

CREATE TABLE IF NOT EXISTS public.revenue_agent_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.revenue_agent_runs(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenue_agent_run_events_run_id_idx
  ON public.revenue_agent_run_events (run_id);
CREATE INDEX IF NOT EXISTS revenue_agent_run_events_created_at_idx
  ON public.revenue_agent_run_events (created_at DESC);

-- ─── RLS Policies ───────────────────────────────────────────────
-- Service role bypasses RLS. Browser access is blocked — all
-- reads and writes go through API routes that use the service role.

ALTER TABLE public.revenue_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_agent_run_events ENABLE ROW LEVEL SECURITY;

-- No direct browser policies — all access via service role in API routes.

-- ─── Updated_at trigger ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS revenue_agent_runs_touch ON public.revenue_agent_runs;
CREATE TRIGGER revenue_agent_runs_touch
  BEFORE UPDATE ON public.revenue_agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS revenue_agent_approvals_touch ON public.revenue_agent_approvals;
CREATE TRIGGER revenue_agent_approvals_touch
  BEFORE UPDATE ON public.revenue_agent_approvals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
