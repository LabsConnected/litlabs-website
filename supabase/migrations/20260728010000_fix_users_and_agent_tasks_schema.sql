-- Fix production schema drift: users.id missing default, agent_tasks missing columns
-- These columns should have been created by earlier migrations but were not applied.

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
