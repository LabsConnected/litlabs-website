-- LiTT execution engine lifecycle, leases, and resumable plan state.
-- Extends mission runs for legacy consumers and stores the new engine state
-- independently from the planner's DAG.

ALTER TABLE public.mission_runs
  ADD COLUMN IF NOT EXISTS plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS stalled_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.mission_runs DROP CONSTRAINT IF EXISTS mission_runs_status_check;
ALTER TABLE public.mission_runs
  ADD CONSTRAINT mission_runs_status_check CHECK (
    status IN ('pending', 'queued', 'preparing', 'running', 'paused', 'waiting_approval', 'completed', 'complete', 'failed', 'stalled', 'cancelled', 'skipped')
  );

CREATE UNIQUE INDEX IF NOT EXISTS mission_runs_idempotency_key_idx
  ON public.mission_runs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS mission_runs_lease_idx
  ON public.mission_runs (status, lease_expires_at)
  WHERE status IN ('queued', 'preparing', 'running', 'waiting_approval');

CREATE TABLE IF NOT EXISTS public.litt_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  project_id uuid,
  plan_id text NOT NULL,
  prompt text NOT NULL,
  primary_intent text NOT NULL,
  plan jsonb NOT NULL,
  state jsonb NOT NULL,
  status text NOT NULL,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, plan_id)
);

ALTER TABLE public.litt_execution_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS litt_execution_runs_user_updated_idx
  ON public.litt_execution_runs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS litt_execution_runs_lease_idx
  ON public.litt_execution_runs (status, lease_expires_at)
  WHERE status IN ('queued', 'preparing', 'running', 'waiting_approval');

CREATE OR REPLACE FUNCTION public.touch_mission_run_heartbeat(
  p_run_id uuid,
  p_user_id text,
  p_lease_expires_at timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.mission_runs
  SET heartbeat_at = now(), lease_expires_at = p_lease_expires_at, updated_at = now()
  WHERE id = p_run_id AND user_id = p_user_id
    AND status IN ('queued', 'preparing', 'running', 'waiting_approval')
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.mark_stale_mission_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.mission_runs
  SET status = 'stalled', stalled_at = now(), updated_at = now(),
      error = COALESCE(error, 'Execution lease expired; retry or resolve the run.')
  WHERE status IN ('queued', 'preparing', 'running', 'waiting_approval')
    AND lease_expires_at IS NOT NULL AND lease_expires_at < now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
