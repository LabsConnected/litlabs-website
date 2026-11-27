-- Durable agent-run checkpoints: resumability for runs that die mid-loop.
--
-- Today a crashed process leaves the assistant message frozen at
-- 'streaming' (the read-path reconciler marks it failed) and the
-- action_runs row frozen at 'working' forever. Approval-paused runs
-- already survive death via agent_paused_runs; this table extends the
-- same lease/fence/heartbeat treatment to ordinary in-flight runs.
--
-- One row per action_run (1:1). The executor writes the serialized loop
-- state at each step boundary and heartbeats lease_expires_at while it
-- works. A recovery path claims expired-lease rows under a new
-- execution_token (atomic CAS = cross-instance fence) and resumes the
-- loop from the checkpoint.
--
-- STATUS: PROPOSED — requires owner authorization before applying to
-- any deployed database. Code that uses this table fails closed when it
-- is absent (checkpointing is best-effort and never blocks a run).

create table if not exists public.agent_run_checkpoints (
  id                  uuid primary key default gen_random_uuid(),

  -- Identity: 1:1 with the canonical run ledger + the turn that spawned it.
  action_run_id       uuid not null unique references public.action_runs(id) on delete cascade,
  user_id             uuid not null references public.users(id),
  conversation_id     uuid not null,
  project_id          uuid,
  workspace_id        text,
  assistant_message_id uuid,
  client_request_id   text,

  -- Billing/metering linkage so a resumer settles the SAME run and does
  -- not double-bill: persisted at checkpoint creation.
  agent_run_id        uuid,
  reservation_id      uuid,
  metering_run_id     uuid,

  -- Serialized loop state (same shapes agent_paused_runs already stores).
  messages            jsonb not null default '[]'::jsonb,
  steps_used          integer not null default 0,
  had_intervening_mutation boolean not null default false,
  deferred_tool_calls jsonb,
  baseline_checkpoint_id uuid,
  checkpoint_id       uuid,
  quality_loop_state  jsonb,
  system_prompt       text,
  execution_mode      text,
  model               text,
  phase               text not null default 'loop',

  -- Claim lifecycle (mirrors agent_paused_runs lease columns).
  run_status          text check (run_status in ('processing','completed','failed')),
  execution_token     uuid,
  lease_expires_at    timestamptz,
  last_progress_at    timestamptz,
  attempts            integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_agent_run_checkpoints_recovery
  on public.agent_run_checkpoints (run_status, lease_expires_at)
  where run_status is not null;

create index if not exists idx_agent_run_checkpoints_conversation
  on public.agent_run_checkpoints (conversation_id);

alter table public.agent_run_checkpoints enable row level security;

-- No direct access: all writes go through the SECURITY DEFINER RPCs below
-- using the service role. Deny anon/authenticated outright.
create policy agent_run_checkpoints_deny_all
  on public.agent_run_checkpoints for all
  using (false) with check (false);

-- Atomic claim: only when unclaimed or the lease has expired. Mints a new
-- execution_token (the fence: a zombie executor heartbeating under an old
-- token is rejected). Returns the claimed row or no rows if another
-- claimant won — the standard SKIP-LOCKED-free CAS used elsewhere.
create or replace function public.claim_run_checkpoint(
  p_checkpoint_id uuid,
  p_lease_seconds integer default 90
) returns setof public.agent_run_checkpoints
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.agent_run_checkpoints c
     set run_status      = 'processing',
         execution_token = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_progress_at = now(),
         attempts         = c.attempts + 1,
         updated_at       = now()
   where c.id = p_checkpoint_id
     and c.run_status is distinct from 'completed'
     and (c.execution_token is null or c.lease_expires_at < now())
  returning c.*;
end;
$$;

-- Token-fenced heartbeat: false = fenced (abort), exception = transient.
create or replace function public.renew_run_checkpoint_lease(
  p_checkpoint_id uuid,
  p_execution_token uuid,
  p_lease_seconds integer default 90
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_updated integer;
begin
  update public.agent_run_checkpoints
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_progress_at = now(),
         updated_at       = now()
   where id = p_checkpoint_id
     and execution_token = p_execution_token
     and run_status = 'processing';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- Recovery candidates: claimed but lease-dead, attempts remaining.
create or replace function public.stale_run_checkpoints(p_max_attempts integer default 2)
returns setof public.agent_run_checkpoints
language sql security definer set search_path = public stable as $$
  select * from public.agent_run_checkpoints
   where run_status = 'processing'
     and lease_expires_at < now()
     and attempts < p_max_attempts;
$$;

revoke all on public.agent_run_checkpoints from anon, authenticated;
revoke execute on function public.claim_run_checkpoint(uuid, integer) from anon, authenticated;
revoke execute on function public.renew_run_checkpoint_lease(uuid, uuid, integer) from anon, authenticated;
revoke execute on function public.stale_run_checkpoints(integer) from anon, authenticated;
