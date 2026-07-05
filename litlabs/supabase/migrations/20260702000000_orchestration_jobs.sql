create table if not exists rate_limit_store (
  key text primary key,
  count integer not null default 1,
  window_start integer not null,
  updated_at timestamp with time zone default now()
);

create index if not exists idx_rate_limit_window_start on rate_limit_store(window_start);

create table if not exists orchestration_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null unique,
  user_id uuid not null references users(id),
  agent1_id text not null,
  agent2_id text not null,
  topic text not null,
  status text not null default 'running' check (status in ('running', 'paused', 'completed')),
  message_count integer default 0,
  max_messages integer default 20,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_orchestration_jobs_user_id on orchestration_jobs(user_id);
create index if not exists idx_orchestration_jobs_status on orchestration_jobs(status);