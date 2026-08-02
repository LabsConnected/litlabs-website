-- ============================================
-- Canonical deployment table for revenue agent runs.
--
-- This consolidates the overlapping deployment tables:
--   - deployments (legacy, GitLab-focused)
--   - project_deployments (integration platform)
--   - integration_projects.vercel_* fields
--
-- The canonical table is `revenue_deployments` and includes
-- all fields required by the deployment contract:
--   userId, projectId, agentRunId, provider, providerDeploymentId,
--   environment, status, previewUrl/productionUrl, source revision,
--   createdAt, completedAt, errorCode, sanitized errorMessage
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.revenue_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  user_id text NOT NULL,
  project_id uuid NOT NULL,
  agent_run_id uuid REFERENCES public.revenue_agent_runs(id) ON DELETE SET NULL,

  -- Provider
  provider text NOT NULL DEFAULT 'vercel'
    CHECK (provider IN ('vercel', 'railway', 'manual', 'system')),
  provider_deployment_id text,

  -- Environment
  environment text NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'preview', 'development')),

  -- Status (from provider)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'building', 'deploying', 'ready', 'live', 'failed', 'canceled')),

  -- URLs (real, never fake)
  preview_url text,
  production_url text,

  -- Source revision / checkpoint
  source_revision text,
  checkpoint_id uuid,

  -- Error tracking (sanitized — no secrets)
  error_code text,
  error_message text,

  -- Metadata
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS revenue_deployments_user_id_idx
  ON public.revenue_deployments (user_id);
CREATE INDEX IF NOT EXISTS revenue_deployments_project_id_idx
  ON public.revenue_deployments (project_id);
CREATE INDEX IF NOT EXISTS revenue_deployments_agent_run_id_idx
  ON public.revenue_deployments (agent_run_id);
CREATE INDEX IF NOT EXISTS revenue_deployments_status_idx
  ON public.revenue_deployments (status);
CREATE INDEX IF NOT EXISTS revenue_deployments_created_at_idx
  ON public.revenue_deployments (created_at DESC);

-- Unique constraint: one deployment per provider deployment ID
CREATE UNIQUE INDEX IF NOT EXISTS revenue_deployments_provider_id_uniq
  ON public.revenue_deployments (provider, provider_deployment_id)
  WHERE provider_deployment_id IS NOT NULL;

-- RLS: service role only
ALTER TABLE public.revenue_deployments ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger
DROP TRIGGER IF EXISTS revenue_deployments_touch ON public.revenue_deployments;
CREATE TRIGGER revenue_deployments_touch
  BEFORE UPDATE ON public.revenue_deployments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
