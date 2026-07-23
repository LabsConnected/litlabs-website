-- ============================================
-- Integration Platform Tables
-- Supports GitHub, Meta Developer, Vercel, Supabase
-- integrations with real-time activity tracking.
--
-- RLS: service_role bypasses (server-side API routes
-- enforce Clerk auth). user_id stores Clerk user ID.
-- ============================================

-- ============================================
-- integration_accounts — per-user integration connections
-- ============================================
CREATE TABLE IF NOT EXISTS public.integration_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('github', 'meta', 'vercel', 'supabase')),
  provider_account_id text,
  provider_account_name text,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'degraded', 'expired', 'missing_permission', 'offline', 'disconnected')),
  status_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  scopes text[],
  last_connected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS integration_accounts_user_id_idx
  ON public.integration_accounts(user_id);
CREATE INDEX IF NOT EXISTS integration_accounts_provider_idx
  ON public.integration_accounts(provider);

-- ============================================
-- integration_projects — projects linked to integrations
-- ============================================
CREATE TABLE IF NOT EXISTS public.integration_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  integration_account_id uuid NOT NULL
    REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  repository_id bigint,
  repository_full_name text,
  repository_html_url text,
  repository_private boolean DEFAULT false,
  default_branch text DEFAULT 'main',
  working_branch text,
  framework text,
  database text,
  runtime text,
  vercel_project_id text,
  vercel_deployment_url text,
  vercel_production_url text,
  vercel_status text,
  github_actions_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_prs_count int DEFAULT 0,
  open_issues_count int DEFAULT 0,
  uncommitted_changes int DEFAULT 0,
  latest_commit_sha text,
  latest_commit_message text,
  latest_commit_author text,
  latest_commit_date timestamptz,
  last_synced_at timestamptz,
  sync_status text NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('synced', 'syncing', 'behind', 'error', 'pending')),
  sync_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_projects_user_id_idx
  ON public.integration_projects(user_id);
CREATE INDEX IF NOT EXISTS integration_projects_account_id_idx
  ON public.integration_projects(integration_account_id);

-- ============================================
-- integration_credentials — encrypted server-side credentials
-- Never exposed to the browser. Stores installation tokens,
-- refresh tokens, app secrets, etc.
-- ============================================
CREATE TABLE IF NOT EXISTS public.integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_account_id uuid NOT NULL
    REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  credential_type text NOT NULL,
  encrypted_value text NOT NULL,
  expires_at timestamptz,
  scopes text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_credentials_account_id_idx
  ON public.integration_credentials(integration_account_id);

-- ============================================
-- integration_sync_runs — audit trail of sync operations
-- ============================================
CREATE TABLE IF NOT EXISTS public.integration_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_account_id uuid
    REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  integration_project_id uuid
    REFERENCES public.integration_projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms int,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_sync_runs_account_id_idx
  ON public.integration_sync_runs(integration_account_id);
CREATE INDEX IF NOT EXISTS integration_sync_runs_project_id_idx
  ON public.integration_sync_runs(integration_project_id);

-- ============================================
-- integration_events — unified event stream
-- Commits, builds, deployments, PRs, Meta webhooks, agent activity
-- ============================================
CREATE TABLE IF NOT EXISTS public.integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  integration_project_id uuid
    REFERENCES public.integration_projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'success', 'warning', 'error', 'critical')),
  actor text,
  actor_avatar_url text,
  url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_events_user_id_idx
  ON public.integration_events(user_id);
CREATE INDEX IF NOT EXISTS integration_events_project_id_idx
  ON public.integration_events(integration_project_id);
CREATE INDEX IF NOT EXISTS integration_events_created_at_idx
  ON public.integration_events(created_at DESC);
CREATE INDEX IF NOT EXISTS integration_events_unread_idx
  ON public.integration_events(user_id) WHERE read_at IS NULL;

-- ============================================
-- project_deployments — deployment tracking
-- ============================================
CREATE TABLE IF NOT EXISTS public.project_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  integration_project_id uuid NOT NULL
    REFERENCES public.integration_projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  deployment_id text,
  environment text NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'preview', 'development')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'building', 'ready', 'error', 'canceled')),
  url text,
  commit_sha text,
  commit_message text,
  branch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_project_id, deployment_id)
);

CREATE INDEX IF NOT EXISTS project_deployments_user_id_idx
  ON public.project_deployments(user_id);
CREATE INDEX IF NOT EXISTS project_deployments_project_id_idx
  ON public.project_deployments(integration_project_id);

-- ============================================
-- project_activity — per-project activity log
-- ============================================
CREATE TABLE IF NOT EXISTS public.project_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  integration_project_id uuid NOT NULL
    REFERENCES public.integration_projects(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  title text NOT NULL,
  description text,
  actor text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_activity_user_id_idx
  ON public.project_activity(user_id);
CREATE INDEX IF NOT EXISTS project_activity_project_id_idx
  ON public.project_activity(integration_project_id);
CREATE INDEX IF NOT EXISTS project_activity_created_at_idx
  ON public.project_activity(created_at DESC);

-- ============================================
-- Row Level Security — service_role only
-- ============================================
ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_activity ENABLE ROW LEVEL SECURITY;

-- service_role full access on all tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'integration_accounts', 'integration_projects', 'integration_credentials',
    'integration_sync_runs', 'integration_events', 'project_deployments', 'project_activity'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY service_role_all_%I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- No anon/authenticated policies: all access is server-side via service_role.
