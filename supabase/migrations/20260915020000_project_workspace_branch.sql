-- ============================================
-- Project source: workspace_branch
--
-- Every provisioned LiTT workspace is Git-backed and has a real
-- branch. Managed (non-GitHub) projects store NULL in github_branch
-- by design — they have no GitHub branch — so branch resolution fell
-- through to NULL and the UI rendered "—" for a project that actually
-- had a `main` branch on disk.
--
-- workspace_branch records the branch of the WORKSPACE, which is the
-- truthful concept: it is what `git branch --show-current` reports in
-- the directory the terminal, preview and agent all share. It sits
-- with the other workspace_* columns rather than pretending to be a
-- GitHub field.
--
-- github_branch keeps its existing meaning (the branch tracked on the
-- GitHub remote) and is untouched, so GitHub-backed projects are not
-- migrated incorrectly.
-- ============================================

BEGIN;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_branch TEXT;

-- Backfill: GitHub-backed projects already know their working branch.
-- Only rows with a prepared workspace are backfilled — an unprovisioned
-- project has no workspace and therefore no workspace branch.
UPDATE public.studio_projects
  SET workspace_branch = COALESCE(github_branch, github_default_branch)
  WHERE workspace_branch IS NULL
    AND workspace_id IS NOT NULL
    AND COALESCE(github_branch, github_default_branch) IS NOT NULL;

-- Backfill: managed projects with a ready workspace were created by
-- prepareManagedWorkspace(), which always initialises `main`.
UPDATE public.studio_projects
  SET workspace_branch = 'main'
  WHERE workspace_branch IS NULL
    AND workspace_id IS NOT NULL
    AND workspace_status = 'ready'
    AND github_full_name IS NULL;

COMMIT;
