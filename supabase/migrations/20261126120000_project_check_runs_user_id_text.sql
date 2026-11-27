-- Fix project_check_runs.user_id type: callers pass Clerk user IDs
-- (text, e.g. "user_..."), matching the studio_projects.user_id
-- convention — NOT Supabase auth UUIDs. The original
-- 20261125140000_create_project_check_runs migration declared the
-- column uuid, so every insert failed with 22P02
-- (project-checks:persist_failed on staging, verified live).
--
-- Postgres refuses ALTER COLUMN TYPE while a policy depends on the
-- column (0A000), so every policy referencing user_id is dropped first.
-- owner_insert is recreated by 20261126130000 on replays; owner_select is
-- recreated below. Dropping owner_insert here is a no-op on first apply
-- (the policy does not exist yet) and is required for idempotent re-runs.
drop policy if exists project_check_runs_owner_select on public.project_check_runs;
drop policy if exists project_check_runs_owner_insert on public.project_check_runs;

alter table public.project_check_runs
  alter column user_id type text using user_id::text;

-- The owner-select policy compared auth.uid() (uuid) to user_id; keep it
-- valid under the new text type. The app uses the service role (which
-- bypasses RLS) for these reads/writes, but the policy must not error.
create policy project_check_runs_owner_select
  on public.project_check_runs
  for select
  using (user_id = auth.uid()::text);
