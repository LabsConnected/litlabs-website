-- ============================================================
-- User-project deployments.
--
-- The existing public.deployments table tracks LiTT's OWN CI/CD pipeline:
-- it is keyed on branch / commit_sha / pipeline_url with source in
-- (gitlab, manual, deploy-agent, vercel) and has NO user_id or project_id.
-- It cannot express "user U published project P", and reusing it would mix
-- LiTT infrastructure deploys with user-project deploys.
--
-- These tables are for the USER'S generated project only. Every row is
-- owned by a user and scoped to one of that user's projects.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.project_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership. user_id is a Clerk user id (text), matching studio_projects.
  user_id text NOT NULL,
  project_id uuid NOT NULL,
  -- The workspace the artifact was collected from, recorded so a deployment
  -- can never be re-attributed to a different workspace after the fact.
  workspace_id text NOT NULL,

  -- Lifecycle. 'ready' is only ever written after the public URL verifies.
  status text NOT NULL CHECK (status IN ('not_started', 'building', 'deploying', 'ready', 'failed')),

  -- Deployment target adapter. 'litt-static' serves the stored artifact from
  -- this app at a public URL; future adapters (r2, cloudflare-pages) slot in
  -- here without changing the agent tool.
  target text NOT NULL DEFAULT 'litt-static',

  public_url text,
  -- Set only after an actual HTTP fetch of public_url succeeded.
  url_verified boolean NOT NULL DEFAULT false,

  file_count integer NOT NULL DEFAULT 0,
  total_bytes integer NOT NULL DEFAULT 0,
  -- sha256 of the artifact, used to suppress duplicate deployments of
  -- identical content (a model that calls the deploy tool twice).
  content_hash text,

  -- Safe failure reporting. No provider credentials are ever stored here.
  error_class text,
  error_message text,

  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_project_deployments_project
  ON public.project_deployments(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_deployments_user
  ON public.project_deployments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_deployments_status
  ON public.project_deployments(status);

-- Duplicate suppression: at most one READY deployment per project per
-- artifact content hash. A second deploy of byte-identical content reuses
-- the existing row instead of publishing again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_deployments_ready_content
  ON public.project_deployments(project_id, content_hash)
  WHERE status = 'ready' AND content_hash IS NOT NULL;

-- ── Artifact files ──
-- The immutable published snapshot. Separate from the workspace: the
-- workspace keeps changing, a deployment does not.
CREATE TABLE IF NOT EXISTS public.project_deployment_files (
  deployment_id uuid NOT NULL REFERENCES public.project_deployments(id) ON DELETE CASCADE,
  path text NOT NULL,
  content text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  PRIMARY KEY (deployment_id, path)
);

CREATE INDEX IF NOT EXISTS idx_project_deployment_files_deployment
  ON public.project_deployment_files(deployment_id);

-- ── RLS ──
-- Both tables are service-role only, matching this app's access model
-- (see 20260826010000_comprehensive_rls_hardening.sql). The public site
-- serving route reads through the service role in a Next.js route handler,
-- so anon/authenticated PostgREST access is denied outright.
ALTER TABLE public.project_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_deployment_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_deployments_deny_anon ON public.project_deployments;
CREATE POLICY project_deployments_deny_anon ON public.project_deployments
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS project_deployments_deny_authenticated ON public.project_deployments;
CREATE POLICY project_deployments_deny_authenticated ON public.project_deployments
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS project_deployment_files_deny_anon ON public.project_deployment_files;
CREATE POLICY project_deployment_files_deny_anon ON public.project_deployment_files
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS project_deployment_files_deny_authenticated ON public.project_deployment_files;
CREATE POLICY project_deployment_files_deny_authenticated ON public.project_deployment_files
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
