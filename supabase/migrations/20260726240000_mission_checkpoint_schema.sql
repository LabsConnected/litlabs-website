-- ============================================
-- Mission execution, approval, validation,
-- preview, and checkpoint schema.
-- All tables reference the canonical studio_projects table.
-- ============================================

BEGIN;

-- ─── Missions ──────────────────────────────────────────────────
-- A Mission is a persisted workflow definition owned by a user
-- and bound to a canonical project.

CREATE TABLE IF NOT EXISTS public.missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id text NOT NULL,
  name text NOT NULL,
  description text,
  graph jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS missions_project_id_idx ON public.missions (project_id);
CREATE INDEX IF NOT EXISTS missions_user_id_idx ON public.missions (user_id);

-- ─── Mission runs ──────────────────────────────────────────────
-- A run is a single execution of a mission.

CREATE TABLE IF NOT EXISTS public.mission_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_runs_mission_id_idx ON public.mission_runs (mission_id);
CREATE INDEX IF NOT EXISTS mission_runs_project_id_idx ON public.mission_runs (project_id);

-- ─── Mission steps ─────────────────────────────────────────────
-- A step is a single node execution within a run.

CREATE TABLE IF NOT EXISTS public.mission_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.mission_runs(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'skipped')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  sequence_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_steps_run_id_idx ON public.mission_steps (run_id);

-- ─── Mission approvals ─────────────────────────────────────────
-- Server-enforced approval records. A step with status
-- 'waiting_approval' must have a corresponding approval record.

CREATE TABLE IF NOT EXISTS public.mission_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.mission_runs(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.mission_steps(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  user_id text NOT NULL,
  action_type text NOT NULL,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- For file changes: affected files, diff, patch
  affected_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff text,
  patch text,
  risk_level text NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  expires_at timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_approvals_run_id_idx ON public.mission_approvals (run_id);
CREATE INDEX IF NOT EXISTS mission_approvals_pending_idx ON public.mission_approvals (status)
  WHERE status = 'pending';

-- ─── Validation results ────────────────────────────────────────
-- Results of typecheck/lint/test/build run in the workspace.

CREATE TABLE IF NOT EXISTS public.mission_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.mission_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  user_id text NOT NULL,
  command text NOT NULL,
  exit_code integer,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'passed', 'failed', 'skipped', 'not_configured', 'timed_out')),
  stdout text,
  stderr text,
  duration_ms integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS validation_results_run_id_idx ON public.mission_validation_results (run_id);

-- ─── Checkpoints ───────────────────────────────────────────────
-- Git-backed project state snapshots.

CREATE TABLE IF NOT EXISTS public.project_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id text NOT NULL,
  git_sha text NOT NULL,
  label text NOT NULL,
  description text,
  -- The mission run that created this checkpoint (nullable for manual)
  mission_run_id uuid REFERENCES public.mission_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkpoints_project_id_idx ON public.project_checkpoints (project_id);
CREATE INDEX IF NOT EXISTS checkpoints_user_id_idx ON public.project_checkpoints (user_id);

-- ─── Mission artifacts ─────────────────────────────────────────
-- Outputs produced by mission steps (images, files, etc.)

CREATE TABLE IF NOT EXISTS public.mission_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.mission_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.mission_steps(id) ON DELETE SET NULL,
  project_id uuid NOT NULL,
  user_id text NOT NULL,
  artifact_type text NOT NULL,
  name text NOT NULL,
  -- For file artifacts: the path in the workspace
  file_path text,
  -- For URL artifacts: the URL
  url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON public.mission_artifacts (run_id);

COMMIT;
