alter table public.users
  add column if not exists display_name text,
  add column if not exists plan text default 'free',
  add column if not exists cover_url text,
  add column if not exists mood text,
  add column if not exists interests text[],
  add column if not exists social_links jsonb default '{}'::jsonb,
  add column if not exists music_links jsonb default '{}'::jsonb,
  add column if not exists signup_source text,
  add column if not exists signup_referrer text,
  add column if not exists signup_landing_path text,
  add column if not exists signup_utm jsonb default '{}'::jsonb,
  add column if not exists clerk_metadata jsonb default '{}'::jsonb,
  add column if not exists last_seen_at timestamp with time zone;

create index if not exists idx_users_created_at_desc on public.users(created_at desc);
create index if not exists idx_users_signup_source on public.users(signup_source);

create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  storage_path text,
  public_url text,
  prompt text,
  provider text,
  format text default 'image',
  title text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_generated_images_user_created on public.generated_images(user_id, created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  endpoint text unique not null,
  keys jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.orchestration_sessions (
  id uuid primary key default gen_random_uuid(),
  status text default 'running',
  root_agent_role text not null,
  context jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.agent_tasks
  add column if not exists expected_role text,
  add column if not exists payload jsonb default '{}'::jsonb;

alter table public.agent_tasks
  alter column assigned_to drop not null,
  alter column dispatcher drop not null,
  alter column task_input drop not null;

alter table public.agent_tasks drop constraint if exists agent_tasks_status_check;
alter table public.agent_tasks
  add constraint agent_tasks_status_check
  check (status in ('queued', 'processing', 'running', 'success', 'completed', 'failed', 'cancelled'));
