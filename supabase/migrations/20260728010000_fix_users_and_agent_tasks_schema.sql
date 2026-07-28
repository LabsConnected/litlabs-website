-- Fix production schema drift: multiple tables missing columns/defaults
-- These should have been created by earlier migrations but were not applied.

-- 1. Ensure users.id has DEFAULT gen_random_uuid()
--    (some deployments created the table without the default)
ALTER TABLE public.users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2. Ensure agent_tasks has dispatcher and workflow_id columns
--    (defined in 20250101000000_agent_tasks_schema.sql but missing in prod)
ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS dispatcher TEXT;

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS workflow_id TEXT;

-- 3. Ensure legacy projects table has workspace columns
--    (needed for workspace prepare flow on legacy projects)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_status TEXT DEFAULT 'not_prepared';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_root TEXT;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_error TEXT;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_prepared_at TIMESTAMPTZ;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS latest_commit_sha TEXT;

