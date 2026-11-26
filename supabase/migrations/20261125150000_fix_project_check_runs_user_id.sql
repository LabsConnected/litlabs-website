-- ACC-09: project_check_runs.user_id was created as uuid (ACC-07),
-- but every identity in this codebase is a Clerk user ID stored as
-- text — studio_projects.user_id is text ("user_id is a Clerk ID
-- string, not Supabase auth.uid()", migration 20260720000000), and
-- the same pattern holds for user_project_deployments,
-- agent_paused_runs and agent_runs. Every save through
-- saveProjectCheckRun therefore failed with 22P02 "invalid input
-- syntax for type uuid", and the read-back filter in
-- getLatestProjectCheckRun failed the same way, so completed checks
-- never persisted and the Checks panel and Jobs tab fell back to
-- "Not run" (Acceptance Run 1 on aedb2b05). Align the column and
-- the RLS policies with the codebase identity model. The existing
-- SELECT policy also compared auth.uid() (uuid) to the column
-- directly and no INSERT policy existed at all, so any user-scoped
-- write path would have been denied even with the type fixed.
-- The dependent policy must be dropped before the type change:
-- Postgres refuses to alter a column a policy definition uses.
drop policy if exists project_check_runs_owner_select on public.project_check_runs;

alter table public.project_check_runs
  alter column user_id type text using user_id::text;

create policy project_check_runs_owner_select
  on public.project_check_runs
  for select
  using (auth.uid()::text = user_id);

drop policy if exists project_check_runs_owner_insert on public.project_check_runs;
create policy project_check_runs_owner_insert
  on public.project_check_runs
  for insert
  with check (auth.uid()::text = user_id);
