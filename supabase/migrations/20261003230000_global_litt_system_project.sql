-- ============================================
-- Global LiTT: hidden per-user system project
--
-- Global LiTT needs durable project-scoped conversations and memory without
-- consuming a user's normal studio_projects quota or appearing in project
-- pickers/lists. Keep system projects in a dedicated server-only table.
--
-- Existing studio_conversations/messages use UUID project_id values without a
-- database FK to studio_projects, so they can safely scope to this system UUID.
-- The system row also owns one primary canonical conversation for the persistent
-- site-wide operator. Application authorization remains owner-scoped and
-- server-resolved.
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.litt_system_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  system_key text NOT NULL,
  name text NOT NULL,
  primary_conversation_id uuid
    REFERENCES public.studio_conversations(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT litt_system_projects_system_key_check
    CHECK (system_key IN ('global_litt')),
  CONSTRAINT litt_system_projects_owner_key_unique
    UNIQUE (owner_id, system_key),
  CONSTRAINT litt_system_projects_primary_conversation_unique
    UNIQUE (primary_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_litt_system_projects_owner
  ON public.litt_system_projects(owner_id);

ALTER TABLE public.litt_system_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS litt_system_projects_service_role
  ON public.litt_system_projects;
CREATE POLICY litt_system_projects_service_role
  ON public.litt_system_projects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- No anon/authenticated policy. All access is through authenticated server
-- routes using the service role, matching studio_projects' server-owned model.

CREATE OR REPLACE FUNCTION public.litt_system_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_litt_system_projects_updated_at
  ON public.litt_system_projects;
CREATE TRIGGER trigger_litt_system_projects_updated_at
  BEFORE UPDATE ON public.litt_system_projects
  FOR EACH ROW EXECUTE FUNCTION public.litt_system_projects_updated_at();

COMMIT;
