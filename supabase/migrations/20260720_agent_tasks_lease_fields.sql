-- Extend agent_tasks for atomic claiming, leases, retries, and observability.
-- These columns support the Autonomic Worker Reliability pass.

alter table if exists public.agent_tasks
  add column if not exists claimed_by uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count int not null default 0,
  add column if not exists max_attempts int not null default 3,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error text;

-- Helpful indexes for claim + recovery queries
create index if not exists agent_tasks_status_lease_idx
  on public.agent_tasks (status, lease_expires_at);

create index if not exists agent_tasks_assigned_status_idx
  on public.agent_tasks (assigned_to, status);

create index if not exists agent_tasks_idempotency_idx
  on public.agent_tasks (idempotency_key) where idempotency_key is not null;
