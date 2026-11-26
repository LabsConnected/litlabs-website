-- Rollback for 20261126120000_project_check_runs_user_id_text (staging).
-- Restores user_id to uuid. SAFE ONLY while no text (Clerk) user_id
-- values exist — i.e. before any successful insert post-apply, or after
-- deleting rows with non-UUID user_id. With 0 pre-existing rows and the
-- feature dead on staging until applied, this is the expected state.
--
--   delete from public.project_check_runs
--    where user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

begin;

drop policy if exists project_check_runs_owner_select on public.project_check_runs;

alter table public.project_check_runs
  alter column user_id type uuid using user_id::uuid;

create policy project_check_runs_owner_select
  on public.project_check_runs
  for select
  using (auth.uid() = user_id);

commit;
