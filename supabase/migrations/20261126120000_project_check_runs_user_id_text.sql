-- Fix project_check_runs.user_id type: callers pass Clerk user IDs
-- (text, e.g. "user_..."), matching the studio_projects.user_id
-- convention — NOT Supabase auth UUIDs. The original
-- 20261125140000_create_project_check_runs migration declared the
-- column uuid, so every insert failed with 22P02
-- (project-checks:persist_failed on staging, verified live).
alter table public.project_check_runs
  alter column user_id type text using user_id::text;

-- The owner-select policy compared auth.uid() (uuid) to user_id; keep it
-- valid under the new text type. The app uses the service role (which
-- bypasses RLS) for these reads/writes, but the policy must not error.
drop policy if exists project_check_runs_owner_select on public.project_check_runs;
create policy project_check_runs_owner_select
  on public.project_check_runs
  for select
  using (user_id = auth.uid()::text);
