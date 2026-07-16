-- ============================================
-- Studio Projects (GitHub-backed)
-- Replaces the old local-first studio_projects table
-- with a GitHub-backed schema that supports repo
-- scanning, file indexing, and webhook sync.
--
-- RLS: service_role bypasses (server-side API routes
-- enforce Clerk auth). user_id stores the Clerk user ID
-- as text — NOT auth.uid() (Supabase auth is not used).
-- ============================================

-- Drop the old local-first studio_projects table if it exists.
-- It used text PK, clerk_id, files jsonb — incompatible with this schema.
DROP TABLE IF EXISTS public.studio_projects CASCADE;

CREATE TABLE IF NOT EXISTS public.studio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  github_installation_id bigint,
  github_repository_id bigint,
  github_owner text,
  github_repo text,
  github_full_name text,
  github_default_branch text DEFAULT 'main',
  github_branch text DEFAULT 'main',
  latest_commit_sha text,
  framework text,
  package_manager text,
  root_directory text DEFAULT '.',
  development_command text,
  build_command text,
  test_command text,
  install_command text,
  scan_status text NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending', 'scanning', 'ready', 'failed')),
  scan_error text,
  scan_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, github_repository_id)
);

CREATE INDEX IF NOT EXISTS studio_projects_user_id_idx
  ON public.studio_projects(user_id);

CREATE INDEX IF NOT EXISTS studio_projects_scan_status_idx
  ON public.studio_projects(scan_status);

-- ============================================
-- Project Files — indexed file tree per project
-- ============================================
CREATE TABLE IF NOT EXISTS public.project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL
    REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  file_type text,
  language text,
  size_bytes bigint,
  sha text,
  is_generated boolean NOT NULL DEFAULT false,
  is_ignored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, path)
);

CREATE INDEX IF NOT EXISTS project_files_project_id_idx
  ON public.project_files(project_id);

-- ============================================
-- Project Scans — audit trail of scan runs
-- ============================================
CREATE TABLE IF NOT EXISTS public.project_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL
    REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  commit_sha text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_scans_project_id_idx
  ON public.project_scans(project_id);

-- ============================================
-- Row Level Security
-- service_role bypasses RLS; all app access is via
-- server-side API routes that enforce Clerk auth.
-- user_id is a Clerk ID string, not Supabase auth.uid().
-- ============================================
ALTER TABLE public.studio_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_scans ENABLE ROW LEVEL SECURITY;

-- service_role full access (used by server API routes)
CREATE POLICY IF NOT EXISTS service_role_all_studio_projects
  ON public.studio_projects
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS service_role_all_project_files
  ON public.project_files
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS service_role_all_project_scans
  ON public.project_scans
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- No anon/authenticated policies: all access is server-side via service_role.
-- This prevents any client-side Supabase call from touching these tables.
