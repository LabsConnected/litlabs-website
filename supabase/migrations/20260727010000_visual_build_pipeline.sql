-- ============================================
-- Visual build pipeline tables
-- Project-bound visual builds, plans, manifests,
-- project assets, previews, and review records.
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.visual_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued',
      'planning_visuals',
      'searching_project_assets',
      'searching_stock_assets',
      'generating_assets',
      'validating_assets',
      'saving_assets',
      'building',
      'rendering',
      'capturing',
      'reviewing',
      'awaiting_approval',
      'repairing',
      'complete',
      'partial',
      'failed'
    )),
  visual_plan_id uuid,
  asset_manifest_id uuid,
  preview_id uuid,
  repair_pass integer NOT NULL DEFAULT 0,
  repair_limit integer NOT NULL DEFAULT 1,
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visual_builds_project_id_idx ON public.visual_builds (project_id);
CREATE INDEX IF NOT EXISTS visual_builds_mission_id_idx ON public.visual_builds (mission_id);
CREATE INDEX IF NOT EXISTS visual_builds_status_idx ON public.visual_builds (status);
CREATE INDEX IF NOT EXISTS visual_builds_workspace_id_idx ON public.visual_builds (workspace_id);

CREATE TABLE IF NOT EXISTS public.visual_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  build_id uuid NOT NULL REFERENCES public.visual_builds(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (build_id)
);

CREATE INDEX IF NOT EXISTS visual_plans_project_id_idx ON public.visual_plans (project_id);
CREATE INDEX IF NOT EXISTS visual_plans_mission_id_idx ON public.visual_plans (mission_id);

CREATE TABLE IF NOT EXISTS public.visual_asset_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  build_id uuid NOT NULL REFERENCES public.visual_builds(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (build_id)
);

CREATE INDEX IF NOT EXISTS visual_asset_manifests_project_id_idx ON public.visual_asset_manifests (project_id);
CREATE INDEX IF NOT EXISTS visual_asset_manifests_mission_id_idx ON public.visual_asset_manifests (mission_id);

CREATE TABLE IF NOT EXISTS public.project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  build_id uuid NOT NULL REFERENCES public.visual_builds(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  source_type text NOT NULL
    CHECK (source_type IN ('project', 'stock', 'generated', 'uploaded')),
  provider text NOT NULL,
  original_url text,
  stored_url text NOT NULL,
  attribution text,
  license text,
  prompt text,
  query text,
  section_key text,
  width integer,
  height integer,
  bytes integer NOT NULL DEFAULT 0,
  checksum text NOT NULL,
  content_type text NOT NULL,
  inspection jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected boolean NOT NULL DEFAULT false,
  rejected boolean NOT NULL DEFAULT false,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, checksum)
);

CREATE INDEX IF NOT EXISTS project_assets_project_id_idx ON public.project_assets (project_id);
CREATE INDEX IF NOT EXISTS project_assets_mission_id_idx ON public.project_assets (mission_id);
CREATE INDEX IF NOT EXISTS project_assets_build_id_idx ON public.project_assets (build_id);
CREATE INDEX IF NOT EXISTS project_assets_checksum_idx ON public.project_assets (checksum);

CREATE TABLE IF NOT EXISTS public.preview_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  build_id uuid NOT NULL REFERENCES public.visual_builds(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  viewport text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  screenshot_url text,
  console_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_requests jsonb NOT NULL DEFAULT '[]'::jsonb,
  horizontal_overflow boolean NOT NULL DEFAULT false,
  document_width integer,
  viewport_width integer,
  broken_images integer NOT NULL DEFAULT 0,
  missing_fonts integer NOT NULL DEFAULT 0,
  layout_shifts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS preview_captures_project_id_idx ON public.preview_captures (project_id);
CREATE INDEX IF NOT EXISTS preview_captures_mission_id_idx ON public.preview_captures (mission_id);
CREATE INDEX IF NOT EXISTS preview_captures_build_id_idx ON public.preview_captures (build_id);

CREATE TABLE IF NOT EXISTS public.visual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  build_id uuid NOT NULL REFERENCES public.visual_builds(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  verdict text NOT NULL DEFAULT 'repair'
    CHECK (verdict IN ('pass', 'repair', 'fail')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visual_reviews_project_id_idx ON public.visual_reviews (project_id);
CREATE INDEX IF NOT EXISTS visual_reviews_mission_id_idx ON public.visual_reviews (mission_id);
CREATE INDEX IF NOT EXISTS visual_reviews_build_id_idx ON public.visual_reviews (build_id);

CREATE TABLE IF NOT EXISTS public.visual_build_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES public.visual_builds(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  stage text NOT NULL,
  level text NOT NULL DEFAULT 'info'
    CHECK (level IN ('info', 'warn', 'error', 'success')),
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visual_build_logs_build_id_idx ON public.visual_build_logs (build_id);
CREATE INDEX IF NOT EXISTS visual_build_logs_project_id_idx ON public.visual_build_logs (project_id);
CREATE INDEX IF NOT EXISTS visual_build_logs_stage_idx ON public.visual_build_logs (stage);
CREATE INDEX IF NOT EXISTS visual_build_logs_created_at_idx ON public.visual_build_logs (created_at);

ALTER TABLE public.visual_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_asset_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preview_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_build_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'visual_builds',
    'visual_plans',
    'visual_asset_manifests',
    'project_assets',
    'preview_captures',
    'visual_reviews',
    'visual_build_logs'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY service_role_all_%I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

COMMIT;
