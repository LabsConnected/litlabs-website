-- ============================================================================
-- Project Loops — automated build cycles
-- ============================================================================
-- A "loop" is the unit of work for the Project Loops feature. A loop
-- carries:
--   - the goal & acceptance criteria,
--   - the GitHub repo + base/working branches,
--   - the safety limits (max iterations, tokens, cost, file changes),
--   - cumulative usage (tokens, cost, file changes),
--   - the most recent diff / review / approval.
--
-- Events are written as the loop runs so the UI can stream them live.
-- ============================================================================

create table if not exists public.project_loops (
  id                text primary key,
  project_id        text,
  repo              text not null,
  base_branch       text not null default 'main',
  working_branch    text not null,
  goal              text not null,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  status            text not null default 'draft',
  phase             text not null default 'queued',
  iteration         integer not null default 0,
  max_iterations    integer not null default 5,
  limits            jsonb not null default '{}'::jsonb,
  tokens_used       integer not null default 0,
  cost_cents        integer not null default 0,
  file_changes      integer not null default 0,
  last_diff         jsonb,
  last_review       jsonb,
  last_approval     jsonb,
  pull_request_url  text,
  rollback_sha      text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists project_loops_updated_at_idx
  on public.project_loops (updated_at desc);
create index if not exists project_loops_status_idx
  on public.project_loops (status);
create index if not exists project_loops_repo_idx
  on public.project_loops (repo);

create table if not exists public.project_loop_events (
  id         text primary key,
  loop_id    text not null references public.project_loops(id) on delete cascade,
  iteration  integer not null default 0,
  role       text,
  phase      text not null,
  level      text not null default 'info',
  message    text not null,
  detail     text,
  at         timestamptz not null default now()
);

create index if not exists project_loop_events_loop_at_idx
  on public.project_loop_events (loop_id, at);
create index if not exists project_loop_events_phase_idx
  on public.project_loop_events (phase);

-- Auto-bump updated_at
create or replace function public.project_loops_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists trg_project_loops_touch on public.project_loops;
create trigger trg_project_loops_touch
  before update on public.project_loops
  for each row execute function public.project_loops_touch_updated_at();

-- ============================================================================
-- Row-level security
-- ============================================================================
alter table public.project_loops enable row level security;
alter table public.project_loop_events enable row level security;

-- Loops are owned by the creator (clerk user id) — for now we expose them
-- only via the service role inside the runner; the API routes are responsible
-- for scope-checking. We still allow SELECT for the owner.
drop policy if exists project_loops_owner_select on public.project_loops;
create policy project_loops_owner_select on public.project_loops
  for select using (created_by = current_setting('request.jwt.claim.sub', true));

drop policy if exists project_loops_owner_write on public.project_loops;
create policy project_loops_owner_write on public.project_loops
  for all using (created_by = current_setting('request.jwt.claim.sub', true))
  with check (created_by = current_setting('request.jwt.claim.sub', true));

drop policy if exists project_loop_events_owner_select on public.project_loop_events;
create policy project_loop_events_owner_select on public.project_loop_events
  for select using (
    exists (
      select 1 from public.project_loops l
      where l.id = project_loop_events.loop_id
        and l.created_by = current_setting('request.jwt.claim.sub', true)
    )
  );

drop policy if exists project_loop_events_owner_write on public.project_loop_events;
create policy project_loop_events_owner_write on public.project_loop_events
  for all using (
    exists (
      select 1 from public.project_loops l
      where l.id = project_loop_events.loop_id
        and l.created_by = current_setting('request.jwt.claim.sub', true)
    )
  )
  with check (
    exists (
      select 1 from public.project_loops l
      where l.id = project_loop_events.loop_id
        and l.created_by = current_setting('request.jwt.claim.sub', true)
    )
  );
