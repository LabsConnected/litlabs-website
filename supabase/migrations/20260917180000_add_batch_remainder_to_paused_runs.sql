-- Approval no longer silently drops the rest of a tool batch.
--
-- When the permission engine requires approval mid-batch, the calls after the
-- gated call were never executed and never persisted. These columns carry the
-- unexecuted remainder on the paused run so resume re-injects it after the
-- approved tool runs, plus the run counters captured at pause time so the
-- resumed run continues its budget instead of restarting it at 0.
alter table public.agent_paused_runs
  add column if not exists deferred_tool_calls jsonb,
  add column if not exists steps_used integer,
  add column if not exists had_intervening_mutation boolean;

comment on column public.agent_paused_runs.deferred_tool_calls is
  'Unexecuted remainder of the tool batch that hit the approval gate; re-injected after the approved tool runs on resume';
comment on column public.agent_paused_runs.steps_used is
  'Agent-loop step budget already consumed before the pause';
comment on column public.agent_paused_runs.had_intervening_mutation is
  'Whether any mutation had executed before the pause';
