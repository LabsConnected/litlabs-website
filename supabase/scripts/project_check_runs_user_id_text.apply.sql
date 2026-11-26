-- TARGETED staging-only apply for migration
-- 20261126120000_project_check_runs_user_id_text.sql
--
-- Project: litlabs-preview (txsalzljvglbrnldikco) — STAGING ONLY.
-- Do NOT run against production. Apply via:
--   npx supabase db query --linked -f supabase/scripts/project_check_runs_user_id_text.apply.sql
-- (requires `supabase link` to the staging project; verify project-ref
--  first: type supabase/.temp/project-ref)
--
-- Pre-verified 2026-11-26 against staging:
--   * project_check_runs exists, 0 rows (no data migration risk)
--   * user_id is uuid; project_id is uuid (studio_projects.id is uuid —
--     unchanged, correct)
--   * sole policy: project_check_runs_owner_select (auth.uid() = user_id)
--   * every insert failed 22P02 because callers pass Clerk IDs (text)
--
-- Rollback: supabase/scripts/project_check_runs_user_id_text.rollback.sql

begin;

alter table public.project_check_runs
  alter column user_id type text using user_id::text;

drop policy if exists project_check_runs_owner_select on public.project_check_runs;
create policy project_check_runs_owner_select
  on public.project_check_runs
  for select
  using (user_id = auth.uid()::text);

commit;

-- Post-apply verification (run separately):
--   select data_type from information_schema.columns
--    where table_schema='public' and table_name='project_check_runs'
--      and column_name='user_id';            -- expect: text
--   insert into public.project_check_runs (project_id, user_id, results, summary)
--     values (gen_random_uuid(), 'user_clerkstyle_test', '{}'::jsonb, '{}'::jsonb)
--     returning id;                          -- expect: success, then delete row
