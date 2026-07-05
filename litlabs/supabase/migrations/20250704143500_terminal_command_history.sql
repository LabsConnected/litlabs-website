create table if not exists public.terminal_command_history (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  session_id text,
  command text not null,
  exit_code integer,
  created_at timestamp with time zone default now()
);

create index if not exists idx_terminal_command_history_user_id on public.terminal_command_history(user_id);
create index if not exists idx_terminal_command_history_created_at on public.terminal_command_history(created_at desc);

alter table public.terminal_command_history enable row level security;

-- Allow users to read their own history
-- (server uses service role key, but this is good practice for direct client access)
create policy "Users can read own command history"
  on public.terminal_command_history
  for select
  using (auth.uid()::text = user_id);

create policy "Users can insert own command history"
  on public.terminal_command_history
  for insert
  with check (auth.uid()::text = user_id);
