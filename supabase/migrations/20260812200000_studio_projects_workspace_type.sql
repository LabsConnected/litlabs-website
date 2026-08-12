-- ============================================
-- Studio Projects: workspace_type column
-- Adds a dedicated workspace_type column to store the LiTT Creation
-- Workspace project type (website, html, game2d, game3d, app, component).
--
-- This is SEPARATE from the `framework` column, which remains for
-- actual runtime technology values (static, nextjs, vite, expo, etc.).
-- The preview manager and terminal runtime depend on `framework` having
-- correct technology values — overwriting it with workspace types
-- would break preview/runtime behavior.
-- ============================================

BEGIN;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'website';

ALTER TABLE public.studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_workspace_type_check;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_workspace_type_check
  CHECK (
    workspace_type IN (
      'website',
      'html',
      'game2d',
      'game3d',
      'app',
      'component'
    )
  );

-- Backfill: any rows that had workspace type values incorrectly stored
-- in the framework column (from commit c1a4d233) should be migrated
-- to workspace_type and framework restored to NULL (since those were
-- not real runtime framework values).
UPDATE public.studio_projects
  SET workspace_type = framework,
      framework = NULL
  WHERE framework IN ('website', 'html', 'game2d', 'game3d', 'app', 'component');

COMMIT;
