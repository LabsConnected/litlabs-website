-- ============================================
-- Sentinel — platform self-monitoring
-- ============================================
-- >>> LARRY MUST RUN THIS in the Supabase dashboard SQL editor <<<
-- (or via the normal migration pipeline) before Sentinel persistence
-- activates. Sentinel degrades gracefully without these tables: probes
-- still run in-memory and /api/owner/sentinel still reports live state,
-- but incidents, leader election, heartbeat and repair candidates
-- need this migration.
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

-- Single-writer lease: only the lease holder runs probe passes, so
-- multi-replica deployments cannot double-probe, double-alert, or
-- double-count consecutive failures. Rows expire; a crashed leader's
-- lease is taken over after LEASE_TTL.
create table if not exists public.sentinel_leader (
  id text primary key default 'leader',
  holder text not null,
  leased_until timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Liveness heartbeat: written at the end of every leader pass. The
-- public /api/health/sentinel endpoint reports its age so an external
-- monitor can detect Sentinel itself dying.
create table if not exists public.sentinel_heartbeat (
  id text primary key default 'heartbeat',
  last_pass_at timestamptz not null,
  holder text,
  updated_at timestamptz not null default now()
);

-- Repair candidates: critical incidents become proposed engineering
-- repair jobs. Lifecycle is approval-gated — nothing here executes
-- code. Dedup by (service_id, signature); cooldown and attempt caps
-- prevent repair loops; diagnostics are stored sanitized.
create table if not exists public.sentinel_repair_candidates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid,
  service_id text not null,
  signature text not null,
  state text not null default 'proposed'
    check (state in ('proposed', 'approved', 'running', 'pr_open', 'resolved', 'rejected', 'cancelled', 'failed')),
  severity text not null default 'critical'
    check (severity in ('warning', 'critical')),
  summary text not null default '',
  diagnostics jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  cooldown_until timestamptz,
  budget_units integer not null default 0,
  max_budget_units integer not null default 10,
  pr_url text,
  audit jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sentinel_service_status enable row level security;
alter table public.sentinel_incidents enable row level security;
alter table public.sentinel_leader enable row level security;
alter table public.sentinel_heartbeat enable row level security;
alter table public.sentinel_repair_candidates enable row level security;

-- No public policies: only the service role (server-side Sentinel and
-- the owner API routes) reads/writes these tables. Anonymous and
-- authenticated API roles are denied by default.

create index if not exists sentinel_incidents_service_state_idx
  on public.sentinel_incidents (service_id, state);

create index if not exists sentinel_incidents_opened_at_idx
  on public.sentinel_incidents (opened_at desc);

-- One open/progress repair candidate per signature — the dedup key.
create unique index if not exists sentinel_repair_candidates_open_sig_idx
  on public.sentinel_repair_candidates (service_id, signature)
  where state in ('proposed', 'approved', 'running', 'pr_open');

create index if not exists sentinel_repair_candidates_state_idx
  on public.sentinel_repair_candidates (state, created_at desc);
