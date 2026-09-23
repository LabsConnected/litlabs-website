-- Demo lane anonymous usage log (PR1: feat/demo-lane).
--
-- >>> LARRY MUST RUN THIS in the Supabase dashboard SQL editor <<<
-- (production project "supabase-sky-candle") before demo usage persists.
-- The /api/demo/chat route degrades gracefully without this table (the
-- insert is wrapped in try/catch), so the demo works either way — but no
-- anonymous usage will be recorded until this migration is applied.
--
-- Privacy: only hashes are stored — sha256(demo_session UUID) and
-- sha256(client IP). No raw session ids, no raw IPs, no message content.

create table if not exists public.demo_logs (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null,
  message_index integer not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  provider text not null,
  model text not null default '',
  ip_hash text not null default '',
  created_at timestamptz not null default now()
);

alter table public.demo_logs enable row level security;

-- No public policies: only the service role (server API route) writes/reads.
-- Anonymous visitors must NOT be able to read or write this table.

create index if not exists demo_logs_session_hash_idx
  on public.demo_logs (session_hash);

create index if not exists demo_logs_created_at_idx
  on public.demo_logs (created_at desc);
