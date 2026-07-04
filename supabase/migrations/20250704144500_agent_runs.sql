create table if not exists public.agent_runs (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  agent_name text not null,
  task text not null,
  status text not null default 'queued',
  logs text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_agent_runs_user_id on public.agent_runs(user_id);
create index if not exists idx_agent_runs_created_at on public.agent_runs(created_at desc);

alter table public.agent_runs enable row level security;

create policy "Users can read own agent runs"
  on public.agent_runs
  for select
  using (auth.uid()::text = user_id);

create policy "Users can insert own agent runs"
  on public.agent_runs
  for insert
  with check (auth.uid()::text = user_id);
