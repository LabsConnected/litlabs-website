-- Global LiTT system project support
--
-- Adds server-owned per-user system projects to studio_projects.
-- The 'global_litt' system project is the canonical home for Global LiTT
-- conversations — one per user, hidden from normal project lists.
--
-- Design:
-- - is_system=true marks a system-owned project (not user-created)
-- - system_type='global_litt' identifies the Global LiTT project
-- - Unique (user_id, system_type) ensures one Global LiTT project per user
-- - Normal project lists MUST filter WHERE is_system=false
-- - RLS: service_role has full access (API routes enforce user scoping)

-- Add system project columns
ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_type text;

-- Constraint: system_type required when is_system=true
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_studio_projects_system_type'
  ) THEN
    ALTER TABLE public.studio_projects
      ADD CONSTRAINT chk_studio_projects_system_type
      CHECK ((is_system = false) OR (is_system = true AND system_type IS NOT NULL));
  END IF;
END $$;

-- Constraint: system_type only allowed when is_system=true
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_studio_projects_system_type_only'
  ) THEN
    ALTER TABLE public.studio_projects
      ADD CONSTRAINT chk_studio_projects_system_type_only
      CHECK ((is_system = true) OR (system_type IS NULL));
  END IF;
END $$;

-- Unique: one system project per type per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_projects_user_system_type
  ON public.studio_projects(user_id, system_type)
  WHERE is_system = true;

-- Index for non-system project lists (excludes system projects)
CREATE INDEX IF NOT EXISTS idx_studio_projects_user_non_system
  ON public.studio_projects(user_id, updated_at DESC)
  WHERE is_system = false;

-- Comment for documentation
COMMENT ON COLUMN public.studio_projects.is_system IS
  'True for server-owned system projects (e.g. Global LiTT). Hidden from normal project lists.';
COMMENT ON COLUMN public.studio_projects.system_type IS
  'System project type (e.g. ''global_litt''). Only set when is_system=true.';
