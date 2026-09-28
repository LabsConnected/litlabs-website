-- One spatial workspace document per user and project.
-- Chat and task rows stay in studio_conversations and studio_tasks.
-- This table stores layout, object references, notes, and relationships.
-- Runtime truth (messages, runs, approvals) is not copied here.

CREATE TABLE IF NOT EXISTS public.studio_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  document JSONB NOT NULL DEFAULT jsonb_build_object(
    'version', 1,
    'viewport', jsonb_build_object('x', 0, 'y', 0, 'zoom', 1),
    'objects', '[]'::jsonb,
    'relationships', '[]'::jsonb
  ),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT studio_workspaces_user_project_key UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_studio_workspaces_user_project
  ON public.studio_workspaces(user_id, project_id);

ALTER TABLE public.studio_workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_workspaces_deny_anon ON public.studio_workspaces;
CREATE POLICY studio_workspaces_deny_anon ON public.studio_workspaces
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS studio_workspaces_deny_authenticated ON public.studio_workspaces;
CREATE POLICY studio_workspaces_deny_authenticated ON public.studio_workspaces
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS studio_workspaces_service_role ON public.studio_workspaces;
CREATE POLICY studio_workspaces_service_role ON public.studio_workspaces
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.studio_workspaces_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_studio_workspaces_updated_at ON public.studio_workspaces;
CREATE TRIGGER trigger_studio_workspaces_updated_at
  BEFORE UPDATE ON public.studio_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.studio_workspaces_updated_at();

COMMENT ON TABLE public.studio_workspaces IS
  'Spatial Studio workspace layout for one user and project. Object payloads reference conversations and tasks; they do not replace those tables.';
