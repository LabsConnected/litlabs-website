-- Allow 'unpublished' as a lifecycle status for user project deployments.
--
-- The unpublish flow in src/lib/deployments/deploy-service.ts sets
-- status = 'unpublished', but the original CHECK constraint
-- (20260912230000_add_project_deployments.sql) only allows
-- ('not_started', 'building', 'deploying', 'ready', 'failed'),
-- so DELETE /api/projects/[projectId]/publish fails with a
-- check-constraint violation. Found during staging acceptance test
-- (2026-10-10): publish worked, unpublish returned 400.
--
-- Staging-only note: apply to litlabs-preview via SQL editor.
-- Never apply to production without Larry's explicit tap.

ALTER TABLE public.user_project_deployments
  DROP CONSTRAINT IF EXISTS user_project_deployments_status_check;

ALTER TABLE public.user_project_deployments
  ADD CONSTRAINT user_project_deployments_status_check
  CHECK (status IN ('not_started', 'building', 'deploying', 'ready', 'failed', 'unpublished'));
