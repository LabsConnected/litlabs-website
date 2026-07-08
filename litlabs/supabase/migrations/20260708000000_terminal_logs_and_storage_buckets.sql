-- ============================================
-- Infrastructure the app expects but migrations missed:
--   • terminal_logs table (used by terminal-server/server.ts)
--   • Supabase Storage buckets: media, studio-images
--
-- Run in the Supabase SQL Editor (safe to re-run).
-- ============================================

-- ── terminal_logs ──
create table if not exists public.terminal_logs (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  session_id text not null,
  command text,
  output text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_terminal_logs_user_id on public.terminal_logs(user_id);
create index if not exists idx_terminal_logs_session_id on public.terminal_logs(session_id);
create index if not exists idx_terminal_logs_created_at on public.terminal_logs(created_at desc);

alter table public.terminal_logs enable row level security;

-- Server uses service_role; direct client access should be denied.
-- (Keep the helper from the Clerk+service_role migration if present.)
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_rls_deny_client_access') then
    perform public._rls_deny_client_access('terminal_logs');
  else
    drop policy if exists api_deny_anon on public.terminal_logs;
    drop policy if exists api_deny_authenticated on public.terminal_logs;
    create policy api_deny_anon on public.terminal_logs for all to anon using (false) with check (false);
    create policy api_deny_authenticated on public.terminal_logs for all to authenticated using (false) with check (false);
  end if;
end;
$$;

-- ── terminal_command_history: align with Clerk + service_role architecture ──
-- The existing auth.uid() policies are leftovers from the old Supabase Auth flow.
-- Drop them so the service_role path is the only real access path.
alter table public.terminal_command_history enable row level security;

drop policy if exists "Users can read own command history" on public.terminal_command_history;
drop policy if exists "Users can insert own command history" on public.terminal_command_history;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_rls_deny_client_access') then
    perform public._rls_deny_client_access('terminal_command_history');
  else
    drop policy if exists api_deny_anon on public.terminal_command_history;
    drop policy if exists api_deny_authenticated on public.terminal_command_history;
    create policy api_deny_anon on public.terminal_command_history for all to anon using (false) with check (false);
    create policy api_deny_authenticated on public.terminal_command_history for all to authenticated using (false) with check (false);
  end if;
end;
$$;

-- ── Storage buckets ──
-- The app uploads to these buckets from server-side API routes using service_role.
-- Buckets must exist or storage calls fail silently and media persistence breaks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, null)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-images', 'studio-images', true, 52428800, null)
on conflict (id) do update set public = true;

-- Note: Storage policies are intentionally left to Supabase defaults.
-- Server-side API routes use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Direct anon/authenticated access to these buckets is therefore denied by default.

-- ── Drop legacy auth.uid() policies ──
-- The app uses Clerk + SUPABASE_SERVICE_ROLE_KEY on the server. Old policies
-- based on auth.uid() let authenticated Supabase users bypass the deny policies
-- installed by 20260702130000_rls_policies_clerk_service_role.sql. Remove them.
do $$
declare
  pol record;
begin
  for pol in
    select
      schemaname,
      tablename,
      policyname
    from pg_policies
    where schemaname = 'public'
      and (
        policyname ilike '%auth.uid%'
        or qual::text ilike '%auth.uid()%'
        or with_check::text ilike '%auth.uid()%'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
  end loop;
end;
$$;
