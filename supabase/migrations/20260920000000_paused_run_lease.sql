-- Resumed-run durability: executor lease, progress signal, fencing token.
--
-- Today a resumed approval run is a fire-and-forget promise whose only
-- liveness signal is run_started_at age. The read-side stale detector
-- condemns any run older than RUN_STALE_TIMEOUT_MS (10 min) — which is also
-- the agent loop's own maxRuntimeMs budget — so a legitimately working run
-- is marked failed while still executing, and its eventual unconditional
-- markRunCompleted silently overwrites the recorded failure.
--
-- These columns let the executor prove liveness (lease renewal), prove
-- progress (last_progress_at), and fence stale writes (execution_token).
-- All nullable: rows claimed before this migration simply have no lease and
-- keep the legacy age-based stale rule.

alter table public.agent_paused_runs
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_progress_at timestamptz,
  add column if not exists execution_token uuid;
