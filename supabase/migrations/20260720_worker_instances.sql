-- Worker instances heartbeat table
-- Tracks persistent daemon/worker processes that claim and execute agent_tasks.

create table if not exists public.worker_instances (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null,
  hostname text,
  version text,
  status text not null default 'online', -- online | degraded | offline | stopped
  current_task_id uuid,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  stopped_at timestamptz,
  last_error text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists worker_instances_status_idx on public.worker_instances (status);
create index if not exists worker_instances_heartbeat_idx on public.worker_instances (last_heartbeat_at desc);
create index if not exists worker_instances_current_task_idx on public.worker_instances (current_task_id);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists worker_instances_set_updated_at on public.worker_instances;
create trigger worker_instances_set_updated_at
before update on public.worker_instances
for each row execute function public.set_updated_at();

-- Optional: RLS (service role bypasses). If you enable RLS, only service role should write.
-- alter table public.worker_instances enable row level security;
-- Do NOT create broad policies here; rely on service-role key in the daemon.
