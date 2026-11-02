-- supabase/migrations/20261022120000_call_authorizations.sql

create table if not exists call_kill_switch (
  id boolean primary key default true,
  enabled boolean not null default false,
  check (id = true)
);
insert into call_kill_switch (id, enabled) values (true, false)
  on conflict (id) do nothing;

create table if not exists call_consent (
  phone text primary key,
  consented_at timestamptz not null default now(),
  consented_by text not null
);

create table if not exists call_authorizations (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  spend_cap_cents integer not null default 0,
  set_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists call_authorizations_phone_idx on call_authorizations (phone, created_at desc);

create table if not exists call_attempts (
  phone text not null,
  attempt_date date not null,
  count integer not null default 0,
  primary key (phone, attempt_date)
);

create table if not exists pending_call_requests (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  requested_by text not null,
  status text not null default 'pending_review',
  reason text,
  created_at timestamptz not null default now()
);

alter table call_kill_switch enable row level security;
alter table call_consent enable row level security;
alter table call_authorizations enable row level security;
alter table call_attempts enable row level security;
alter table pending_call_requests enable row level security;
-- No policies added: service-role key only (same pattern as voice_sessions table).
