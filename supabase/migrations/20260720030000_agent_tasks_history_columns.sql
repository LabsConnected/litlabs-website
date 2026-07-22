-- LiTT Base Station — Mission History Columns
-- Extends agent_tasks with persisted mission history metadata.
-- Safe to re-run.

BEGIN;

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cost_credits INTEGER,
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Protect mission accounting from invalid negative values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_tasks_output_tokens_nonnegative'
  ) THEN
    ALTER TABLE public.agent_tasks
      ADD CONSTRAINT agent_tasks_output_tokens_nonnegative
      CHECK (output_tokens IS NULL OR output_tokens >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_tasks_cost_credits_nonnegative'
  ) THEN
    ALTER TABLE public.agent_tasks
      ADD CONSTRAINT agent_tasks_cost_credits_nonnegative
      CHECK (cost_credits IS NULL OR cost_credits >= 0);
  END IF;
END
$$;

-- Supports recent completed-mission queries.
CREATE INDEX IF NOT EXISTS idx_agent_tasks_completed_at
  ON public.agent_tasks (completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- Supports filtering mission history by entry surface.
CREATE INDEX IF NOT EXISTS idx_agent_tasks_source
  ON public.agent_tasks (source)
  WHERE source IS NOT NULL;

-- Backfill timestamps for existing terminal tasks.
UPDATE public.agent_tasks
SET completed_at = updated_at
WHERE completed_at IS NULL
  AND status IN ('success', 'failed', 'cancelled');

COMMIT;
