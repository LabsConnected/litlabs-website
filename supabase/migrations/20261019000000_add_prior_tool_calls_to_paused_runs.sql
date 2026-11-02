-- Approval no longer drops the pre-pause mutation evidence.
--
-- When the permission engine pauses mid-run, mutations that already executed
-- (with their declared paths and read-back persisted flags) lived only in the
-- in-memory toolCallLog. Resume then evaluated the run on post-resume calls
-- alone — a contradicted pre-pause claim could be masked by a later verified
-- one across the approval boundary. This column carries the pre-pause call
-- log so the resumed run's evidence ledger sees the full mutation history.
alter table public.agent_paused_runs
  add column if not exists prior_tool_calls jsonb;

comment on column public.agent_paused_runs.prior_tool_calls is
  'Tool-call log entries (incl. declared paths and persisted read-back flags) for calls that executed BEFORE the approval pause; seeded back into the resumed run so completion evidence covers the whole run';
