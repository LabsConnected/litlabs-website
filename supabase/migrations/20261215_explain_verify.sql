-- ============================================
-- EXPLAIN Verification for /api/usage/stats Index Usage
-- Date: 2026-12-15
--
-- Paste these statements into the Supabase SQL Editor and run
-- them one at a time. The expected output for each is "Index
-- Scan using <index_name>" — if you see "Seq Scan" instead, the
-- index is being ignored (rebuild it, or check statistics with
-- ANALYZE first).
--
-- Replace the literal `'user_xxx'` with a real user_id from your
-- auth.users / users table. The since date can be the literal
-- 14-days-ago timestamp.
-- ============================================

-- ============================================
-- 1. terminal_command_history query
-- ============================================
EXPLAIN (ANALYZE, BUFFERS)
SELECT created_at
FROM public.terminal_command_history
WHERE user_id = 'user_xxx'
  AND created_at >= '2026-12-01T00:00:00Z';

-- Expected: Index Scan using idx_terminal_command_history_user_created
-- If you see Seq Scan: run `ANALYZE public.terminal_command_history;`
-- and re-run the EXPLAIN.


-- ============================================
-- 2. agent_tasks query (uses the partial index)
-- ============================================
EXPLAIN (ANALYZE, BUFFERS)
SELECT created_at
FROM public.agent_tasks
WHERE user_id = 'user_xxx'
  AND created_at >= '2026-12-01T00:00:00Z';

-- Expected: Index Scan using idx_agent_tasks_user_created
-- This index is PARTIAL (WHERE user_id IS NOT NULL) — the planner
-- will only use it for queries with a NOT NULL user_id filter.


-- ============================================
-- 3. agent_runs query
-- ============================================
EXPLAIN (ANALYZE, BUFFERS)
SELECT created_at
FROM public.agent_runs
WHERE user_id = 'user_xxx'
  AND created_at >= '2026-12-01T00:00:00Z';

-- Expected: Index Scan using idx_agent_runs_user_created


-- ============================================
-- 4. Verify the indexes exist with the right shape
-- ============================================
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'terminal_command_history',
    'agent_tasks',
    'agent_runs'
  )
ORDER BY tablename, indexname;

-- Expected rows include:
--   terminal_command_history | idx_terminal_command_history_user_id
--   terminal_command_history | idx_terminal_command_history_created_at
--   terminal_command_history | idx_terminal_command_history_user_created  <-- NEW
--   agent_runs               | idx_agent_runs_user_id
--   agent_runs               | idx_agent_runs_created_at
--   agent_runs               | idx_agent_runs_user_created              <-- NEW
--   agent_tasks              | idx_agent_tasks_user_created              <-- NEW (partial)


-- ============================================
-- 5. Verify the new user_id column on agent_tasks
-- ============================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'agent_tasks'
  AND column_name = 'user_id';

-- Expected: user_id | text | YES


-- ============================================
-- 6. Verify the RLS policies on agent_tasks
-- ============================================
SELECT schemaname, tablename, policyname, permissive, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'agent_tasks';

-- Expected rows: 'Users can read own agent tasks' (SELECT),
--                'Users can insert own agent tasks' (INSERT)


-- ============================================
-- 7. Verify the schema_migrations_marker row was applied
-- ============================================
SELECT * FROM public.schema_migrations_marker
WHERE name = '20261215_usage_stats_schema_fixes';

-- Expected: one row with the name and applied_at timestamp.


-- ============================================
-- 8. Verify the usage_daily_summary view exists
-- ============================================
SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public'
  AND viewname = 'usage_daily_summary';

-- Expected: one row showing the view definition.


-- ============================================
-- 9. Quick row count + planner check on the view
-- ============================================
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public.usage_daily_summary
WHERE user_id = 'user_xxx'
ORDER BY day DESC
LIMIT 30;

-- Expected: a hash-aggregate plan (the view is a UNION ALL of
-- 3 GROUP BY queries). For larger datasets, a materialized view
-- would be faster, but for a 14-day window this is fine.


-- ============================================
-- 10. If any EXPLAIN shows Seq Scan, force statistics refresh:
-- ============================================
-- ANALYZE public.terminal_command_history;
-- ANALYZE public.agent_tasks;
-- ANALYZE public.agent_runs;
