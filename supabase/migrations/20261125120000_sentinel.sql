-- ============================================
-- Sentinel — platform self-monitoring
-- ============================================
-- >>> LARRY MUST RUN THIS in the Supabase dashboard SQL editor <<<
-- (or via the normal migration pipeline) before Sentinel persistence
-- activates. Sentinel degrades gracefully without these tables: probes
-- still run in-memory and /api/owner/sentinel still reports live state,
-- but incidents and cross-restart status history need this migration.
--
-- Privacy: no customer data. Service ids, health levels, latency,
-- sanitized detail strings, and incident summaries only.

create table if not exists public.sentinel_service_status (
  service_id text primary key,
  level text not null default 'unknown'
    check (level in ('operational', 'degraded', 'down', 'unknown')),
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  last_checked_at timestamptz,
  last_change_at timestamptz,
  last_latency_ms integer,
  detail text not null default '',
  open_incident_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.sentinel_incidents (
  id uuid primary key default gen_random_uuid(),
  service_id text not null,
  severity text not null default 'warning'
    check (severity in ('warning', 'critical')),
  state text not null default 'open'
    check (state in ('open', 'resolved')),
  summary text not null default '',
  detail text not null default '',
  remediation jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.sentinel_service_status enable row level security;
alter table public.sentinel_incidents enable row level security;

-- No public policies: only the service role (server-side Sentinel and
-- the owner API route) reads/writes these tables. Anonymous and
-- authenticated API roles are denied by default.

create index if not exists sentinel_incidents_service_state_idx
  on public.sentinel_incidents (service_id, state);

create index if not exists sentinel_incidents_opened_at_idx
  on public.sentinel_incidents (opened_at desc);
