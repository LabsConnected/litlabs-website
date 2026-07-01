-- ============================================
-- Invite Codes + API Keys Schema
-- Run in Supabase Dashboard → SQL Editor
-- ============================================

-- ─────────────────────────────────────────────
-- INVITE CODES
-- ─────────────────────────────────────────────
create table if not exists public.invite_codes (
  id           uuid        primary key default gen_random_uuid(),
  code_hash    text        not null unique,           -- SHA-256 of the raw code (never store raw)
  label        text,                                  -- human label e.g. "Beta Wave 1"
  created_by   text,                                  -- clerk_id of admin who created it
  max_uses     int         not null default 1,
  uses_count   int         not null default 0,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_invite_codes_code_hash on public.invite_codes(code_hash);
create index if not exists idx_invite_codes_created_by on public.invite_codes(created_by);

-- Track which user redeemed which invite (one redemption per invite per user)
create table if not exists public.invite_redemptions (
  id             uuid        primary key default gen_random_uuid(),
  invite_code_id uuid        not null references public.invite_codes(id) on delete cascade,
  user_id        uuid        references public.users(id) on delete set null,
  clerk_id       text,
  redeemed_at    timestamptz not null default now()
);

create index if not exists idx_invite_redemptions_invite_code_id on public.invite_redemptions(invite_code_id);
create index if not exists idx_invite_redemptions_clerk_id on public.invite_redemptions(clerk_id);

-- ─────────────────────────────────────────────
-- API KEYS
-- ─────────────────────────────────────────────
create table if not exists public.api_keys (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null,                  -- clerk_id of the key owner
  name         text        not null,                  -- human label e.g. "My Agent Integration"
  prefix       text        not null,                  -- e.g. "lit_live_ab12" — visible in UI
  key_hash     text        not null unique,            -- SHA-256 of the raw key
  scopes       text[]      not null default '{}',     -- e.g. ARRAY['agents:run', 'media:generate']
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_api_keys_user_id on public.api_keys(user_id);
create index if not exists idx_api_keys_key_hash on public.api_keys(key_hash);

-- ─────────────────────────────────────────────
-- API KEY USAGE LOG
-- ─────────────────────────────────────────────
create table if not exists public.api_key_usage (
  id          uuid        primary key default gen_random_uuid(),
  api_key_id  uuid        not null references public.api_keys(id) on delete cascade,
  endpoint    text        not null,                   -- e.g. "/api/agents/task"
  status      int,                                    -- HTTP status returned
  ip_hash     text,                                   -- hashed client IP for abuse tracking
  created_at  timestamptz not null default now()
);

create index if not exists idx_api_key_usage_api_key_id on public.api_key_usage(api_key_id);
create index if not exists idx_api_key_usage_created_at on public.api_key_usage(created_at desc);

-- ─────────────────────────────────────────────
-- RLS — service role bypasses; Clerk enforces auth in API routes
-- ─────────────────────────────────────────────
alter table public.invite_codes        enable row level security;
alter table public.invite_redemptions  enable row level security;
alter table public.api_keys            enable row level security;
alter table public.api_key_usage       enable row level security;
