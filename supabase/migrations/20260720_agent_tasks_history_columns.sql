-- LiTT Base Station — Mission History Columns
-- Phase 2.2 of the LiTT Base Station cleanup. Extends `agent_tasks` with the
-- columns the Base Station UI needs to render a real mission history instead
-- of an in-memory list. Safe to re-run: every column is ADD COLUMN IF NOT EXISTS.
--
-- New columns:
--   completed_at     — wall-clock when the task reached a terminal status
--   output_tokens    — total tokens produced by the LLM for this task
--   cost_credits     — LBC charged for the task (LITBIT coins)
--   source           — origin channel: "agents-page", "studio", "voice", etc.

BEGIN;

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cost_credits INTEGER,
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Helpful index for the Base Station "mission activity" feed, which sorts by
-- recency and filters by source. Partial index keeps it small in the common
-- case where most historical rows have source = 'agents-page'.
CREATE INDEX IF NOT EXISTS idx_agent_tasks_completed_at
  ON public.agent_tasks (completed_at DESC NULLS LAST)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_source
  ON public.agent_tasks (source)
  WHERE source IS NOT NULL;

-- Backfill completed_at from updated_at for any rows already in a terminal
-- status. This is a best-effort: rows added before the column existed will
-- have NULL completed_at, but terminal rows will get a sane default.
UPDATE public.agent_tasks
   SET completed_at = updated_at
 WHERE completed_at IS NULL
   AND status IN ('success', 'failed', 'cancelled');

COMMIT;
