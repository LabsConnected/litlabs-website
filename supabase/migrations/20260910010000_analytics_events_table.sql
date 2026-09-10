-- analytics_events: durable first-party funnel event storage.
-- The ingestion route uses the service_role key; public and authenticated
-- roles have no direct access. Events are intentionally anonymous on
-- the client side and carry no PII by design.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  ts bigint not null,
  path text,
  referrer text,
  properties jsonb,
  created_at timestamptz default now()
);

-- Fast lookups for funnel/event queries.
create index if not exists idx_analytics_events_event_ts
  on public.analytics_events (event, ts desc);
create index if not exists idx_analytics_events_created_at
  on public.analytics_events (created_at desc);

-- Enforce the no-public-access pattern used across server-only tables.
alter table public.analytics_events enable row level security;

-- No anon/authenticated access. The ingestion route inserts via service_role.
create policy "Deny public read on analytics_events"
  on public.analytics_events
  for select
  to anon, authenticated
  using (false);

create policy "Deny public write on analytics_events"
  on public.analytics_events
  for insert
  to anon, authenticated
  with check (false);
