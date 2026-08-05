-- Migration: Drop legacy projects foreign key constraints to support canonical studio_projects
--
-- 1. Drop foreign key constraint on memories table
ALTER TABLE public.memories DROP CONSTRAINT IF EXISTS memories_project_id_fkey;

-- 2. Drop foreign key constraint on user_active_project table (name generated dynamically)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN (
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
      AND table_name = 'user_active_project' 
      AND constraint_type = 'FOREIGN KEY'
  ) LOOP
    EXECUTE 'ALTER TABLE public.user_active_project DROP CONSTRAINT ' || quote_ident(r.constraint_name);
  END LOOP;
END $$;
