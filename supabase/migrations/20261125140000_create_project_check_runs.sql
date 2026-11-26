-- ACC-07 Item 2: automatic checks on build completion. Every completed
-- check run (automatic at build completion, or on-demand from the Checks
-- panel) persists its seven results here so the Checks panel shows the
-- run's actual results — tied to the project and, for automatic runs, the
-- conversation that produced them — instead of resetting to "Not run"
-- on every load. One row per check run; the panel reads the latest.
create table if not exists public.project_check_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  conversation_id text,
  results jsonb not null,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists project_check_runs_project_created_idx
  on public.project_check_runs (project_id, created_at desc);

alter table public.project_check_runs enable row level security;

drop policy if exists project_check_runs_owner_select on public.project_check_runs;
create policy project_check_runs_owner_select
  on public.project_check_runs
  for select
  using (auth.uid() = user_id);
