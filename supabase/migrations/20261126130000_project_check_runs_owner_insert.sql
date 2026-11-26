-- ACC-09 follow-up: project_check_runs owner INSERT policy.
--
-- The ACC-07 migration (20261125140000) created only a SELECT policy,
-- and the type fix (20261126120000) re-created that SELECT policy for
-- the text user_id. No INSERT policy ever existed, so any user-scoped
-- (non-service-role) insert into project_check_runs would be denied
-- with 42501 even though the table grants INSERT to authenticated.
-- The app writes through the service role today (which bypasses RLS),
-- so this is latent — but the policy must exist for the owner model
-- to be truthful.
drop policy if exists project_check_runs_owner_insert on public.project_check_runs;

create policy project_check_runs_owner_insert
  on public.project_check_runs
  for insert
  with check (auth.uid()::text = user_id);
