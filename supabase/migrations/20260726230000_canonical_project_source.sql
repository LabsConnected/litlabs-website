-- ============================================
-- Canonical Project: source_type, access_mode, template
-- Adds source_type and access_mode to studio_projects
-- so it can represent blank/template projects without GitHub.
-- Also extends workspace_status lifecycle states.
-- Does NOT drop or alter the legacy `projects` table.
-- ============================================

BEGIN;

-- source_type: distinguishes how the project was created
ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'github';

ALTER TABLE public.studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_source_type_check;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_source_type_check
  CHECK (
    source_type IN ('github', 'blank', 'template')
  );

-- access_mode: project visibility / sharing
ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'private';

ALTER TABLE public.studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_access_mode_check;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_access_mode_check
  CHECK (
    access_mode IN ('private', 'shared')
  );

-- template_id: which template was used for blank/template projects
ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS template_id TEXT;

-- Extend workspace_status to include the full lifecycle
ALTER TABLE public.studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_workspace_status_check;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_workspace_status_check
  CHECK (
    workspace_status IN (
      'not_prepared',
      'provisioning',
      'preparing',
      'ready',
      'failed',
      'error',
      'stopped'
    )
  );

-- Backfill: existing rows with github_repository_id are 'github' source
UPDATE public.studio_projects
  SET source_type = 'github'
  WHERE github_repository_id IS NOT NULL AND source_type = 'github';

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS studio_projects_user_id_idx
  ON public.studio_projects (user_id);

CREATE INDEX IF NOT EXISTS studio_projects_workspace_id_idx
  ON public.studio_projects (workspace_id)
  WHERE workspace_id IS NOT NULL;

COMMIT;
