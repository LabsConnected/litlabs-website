-- ============================================
-- Studio Projects: workspace & runtime fields
-- Adds workspace_status, workspace_id, workspace_root,
-- workspace_error, workspace_prepared_at,
-- runtime_status, preview_url, runtime_error
-- to studio_projects.
-- ============================================

BEGIN;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_status TEXT
    NOT NULL DEFAULT 'not_prepared';

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_id TEXT;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_root TEXT;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_error TEXT;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_prepared_at TIMESTAMPTZ;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS runtime_status TEXT
    NOT NULL DEFAULT 'stopped';

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS preview_url TEXT;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS runtime_error TEXT;

ALTER TABLE public.studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_workspace_status_check;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_workspace_status_check
  CHECK (
    workspace_status IN (
      'not_prepared',
      'provisioning',
      'ready',
      'failed'
    )
  );

ALTER TABLE public.studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_runtime_status_check;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_runtime_status_check
  CHECK (
    runtime_status IN (
      'stopped',
      'starting',
      'ready',
      'failed'
    )
  );

COMMIT;
