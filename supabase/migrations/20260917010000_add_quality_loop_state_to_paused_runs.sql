-- Preserve the machine-verified quality ledger across approval pauses.
-- This is intentionally separate from paused_messages: conversational text
-- is not an evidence source and must not be used to reconstruct stage state.
alter table public.agent_paused_runs
  add column if not exists quality_loop_state jsonb;

comment on column public.agent_paused_runs.quality_loop_state is
  'Server-generated quality-loop evidence snapshot captured before approval resume';
