-- Canonical worker heartbeat table for external agent daemon.
-- The UI treats a worker as offline when last_seen_at is older than 90 seconds.

create table if not exists worker_heartbeats (
  worker_id text primary key,
  status text not null check (status in ('healthy', 'degraded', 'offline', 'misconfigured')),
  current_task_id uuid references agent_tasks(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

-- Index for the offline-check query used by /api/agents/worker-health.
create index if not exists idx_worker_heartbeats_last_seen
  on worker_heartbeats (last_seen_at desc);

-- Service-role only: workers must write their own rows.
-- RLS is disabled so the daemon can upsert via the service key.
alter table worker_heartbeats enable row level security;

-- Only the service role touches this table; anon/authenticated users read via API.
drop policy if exists worker_heartbeats_service_only on worker_heartbeats;
create policy worker_heartbeats_service_only
  on worker_heartbeats
  for all
  using (false);
