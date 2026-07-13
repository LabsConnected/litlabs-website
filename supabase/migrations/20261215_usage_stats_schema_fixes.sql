-- ============================================
-- Usage Stats Schema Fixes
-- Date: 2026-12-15
--
-- Fixes the schema gaps that prevented the /api/usage/stats route
-- from working on a fresh database. The route queries 3 tables for
-- daily aggregates:
--
--   1. terminal_command_history
--   2. agent_tasks
--   3. agent_runs
--
-- Issues fixed:
--   A. agent_tasks has NO owner_id column — the route's
--      `.eq("owner_id", userId)` filter was failing on fresh DBs.
--      Adding a `user_id text` column + index.
--   B. terminal_command_history + agent_runs had only single-column
--      indexes (user_id, created_at) but the route does a combined
--      `eq(user_id) + gte(created_at)` filter. Composite indexes make
--      the gte filter use the index instead of a full scan.
--   C. agent_tasks had RLS enabled but no policies. The server uses
--      service-role (bypassrls) but explicit policies are required
--      for any future client-side direct access.
--
-- This migration is idempotent — safe to re-run.
-- ============================================

-- ============================================
-- A. Add user_id column to agent_tasks
-- ============================================
-- NOTE on backfill: we deliberately DO NOT backfill from
-- conversations.id → agent_tasks.session_id. The semantic
-- relationship between the two isn't established (session_id may
-- be a workflow identifier, not a conversation reference), so any
-- backfill could be wrong and silently misattribute data to the
-- wrong user. Existing rows stay NULL and are excluded from the
-- partial index below. New rows should populate user_id at
-- insert time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_tasks'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.agent_tasks ADD COLUMN user_id TEXT;
  END IF;
END
$$;

-- ============================================
-- B. Composite indexes for (user_id, created_at) gte queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_terminal_command_history_user_created
  ON public.terminal_command_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created
  ON public.agent_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_created
  ON public.agent_tasks (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ============================================
-- C. RLS policies for agent_tasks
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_tasks'
      AND policyname = 'Users can read own agent tasks'
  ) THEN
    CREATE POLICY "Users can read own agent tasks"
      ON public.agent_tasks
      FOR SELECT
      USING (auth.uid()::text = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_tasks'
      AND policyname = 'Users can insert own agent tasks'
  ) THEN
    CREATE POLICY "Users can insert own agent tasks"
      ON public.agent_tasks
      FOR INSERT
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END
$$;

-- ============================================
-- D. Schema version marker (for /api/usage/stats health)
-- ============================================
CREATE TABLE IF NOT EXISTS public.schema_migrations_marker (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations_marker (name)
VALUES ('20261215_usage_stats_schema_fixes')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- E. Lightweight view for fast usage aggregates
-- ============================================
-- Pre-aggregated daily counts keyed by user + day. The route can
-- optionally query this view instead of the raw tables, but it's
-- only populated by the trigger below if a real backend job runs.
-- For now this is documentation / future-ready.
CREATE OR REPLACE VIEW public.usage_daily_summary AS
SELECT
  user_id,
  date_trunc('day', created_at)::date AS day,
  COUNT(*) AS total,
  'terminal_command'::text AS source
FROM public.terminal_command_history
WHERE user_id IS NOT NULL
GROUP BY user_id, date_trunc('day', created_at)::date

UNION ALL

SELECT
  user_id,
  date_trunc('day', created_at)::date AS day,
  COUNT(*) AS total,
  'agent_task'::text AS source
FROM public.agent_tasks
WHERE user_id IS NOT NULL
GROUP BY user_id, date_trunc('day', created_at)::date

UNION ALL

SELECT
  user_id,
  date_trunc('day', created_at)::date AS day,
  COUNT(*) AS total,
  'agent_run'::text AS source
FROM public.agent_runs
WHERE user_id IS NOT NULL
GROUP BY user_id, date_trunc('day', created_at)::date;

COMMENT ON VIEW public.usage_daily_summary IS
  'Pre-aggregated daily usage counts. Useful for fast dashboard queries.';
