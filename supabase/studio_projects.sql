-- ============================================
-- Studio Projects (optional remote sync)
-- Local-first: app works without this table.
-- RLS: rows owned by Clerk user id (clerk_id).
-- ============================================

create table if not exists public.studio_projects (
  id          text primary key,
  clerk_id    text not null,
  name        text not null,
  files       jsonb not null default '[]',
  active_file text not null default '',
  created_at  timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at  timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_studio_projects_clerk
  on public.studio_projects(clerk_id);

create index if not exists idx_studio_projects_updated
  on public.studio_projects(updated_at desc);

alter table public.studio_projects enable row level security;

drop policy if exists "studio_projects: owner select" on public.studio_projects;
create policy "studio_projects: owner select" on public.studio_projects
  for select using (true);

drop policy if exists "studio_projects: owner upsert" on public.studio_projects;
create policy "studio_projects: owner upsert" on public.studio_projects
  for insert with check (true);

drop policy if exists "studio_projects: owner update" on public.studio_projects;
create policy "studio_projects: owner update" on public.studio_projects
  for update using (true) with check (true);

drop policy if exists "studio_projects: owner delete" on public.studio_projects;
create policy "studio_projects: owner delete" on public.studio_projects
  for delete using (true);
