-- ============================================
-- Project list indexes
--
-- listProjects (src/lib/projects/project-repository.ts) filters by
-- user_id and orders by updated_at DESC on both studio_projects and the
-- legacy projects table. The existing single-column (user_id) indexes
-- can't satisfy the ORDER BY, so every project-switcher load paid for
-- a sort. These composite indexes cover filter + ordering together.
--
-- Plain CREATE INDEX (not CONCURRENTLY): CONCURRENTLY cannot run inside
-- the transaction Supabase wraps migrations in, and both tables are
-- small — the brief lock is negligible.
--
-- NOTE (audit correction): an earlier audit claimed studio_projects had
-- zero indexes. It does have studio_projects_user_id_idx and
-- studio_projects_workspace_id_idx; what's missing is the composite
-- (user_id, updated_at) the list query actually needs.
-- ============================================

CREATE INDEX IF NOT EXISTS idx_studio_projects_user_updated
  ON public.studio_projects (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_user_updated
  ON public.projects (user_id, updated_at DESC);
