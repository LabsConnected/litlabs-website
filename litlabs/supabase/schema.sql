-- ============================================
-- LiTreeLabStudios Database Schema (Self-Contained)
-- Compatible with Clerk + Next.js API routes (service role key)
-- Run this in Supabase Dashboard → SQL Editor → "New Query" → Run
-- ============================================
-- Drop old auth-dependent constraints if they exist
alter table if exists public.users drop constraint if exists users_id_fkey;
-- Users table (synced with Clerk)
-- id = internal UUID, clerk_id = Clerk's external user ID
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text unique not null,
  email text unique not null,
  name text,
  username text unique,
  avatar_url text,
  bio text,
  website text,
  location text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
-- User Preferences table
create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  theme_mode text default 'dark',
  theme_skin text default 'cyberpunk',
  theme_accent text default 'neon-green',
  crt_enabled boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id)
);
-- User Agent Installs (Dock)
create table if not exists public.user_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  agent_id text not null,
  installed_at timestamp with time zone default timezone('utc'::text, now()) not null,
  is_active boolean default true,
  unique(user_id, agent_id)
);
-- User Subscriptions (for Stripe integration)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text default 'free',
  status text default 'active',
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id)
);
-- LiTBit Coins Wallet
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  balance integer default 500 not null,
  last_claim_date date,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id)
);
-- Coin Transactions (purchase/earn/spend history)
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  type text not null, -- 'purchase', 'earn', 'spend', 'refund'
  amount integer not null,
  balance_after integer not null,
  description text,
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
-- Social Posts
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  content text not null,
  media_urls text[], -- array of image/video URLs
  likes_count integer default 0 not null,
  comments_count integer default 0 not null,
  is_ai_post boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
-- Post Likes
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(post_id, user_id)
);
-- Post Comments
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
-- User Media (gallery uploads)
create table if not exists public.user_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  url text not null,
  type text not null, -- 'image', 'video', 'audio'
  caption text,
  is_public boolean default true not null, -- show in community gallery
  category text default 'gallery', -- 'character', 'landscape', 'abstract', '360-worlds', etc
  likes_count integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
-- Rate Limiting (serverless-safe, Supabase-backed)
create table if not exists public.rate_limits (
  id bigint primary key generated always as identity,
  ip text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists idx_rate_limits_ip_created on public.rate_limits(ip, created_at desc);
-- Auto-cleanup old rate limit entries (older than 5 minutes)
select cron.schedule(
  'cleanup-rate-limits',
  '*/5 * * * *',
  $$delete from public.rate_limits where created_at < now() - interval '5 minutes'$$
);
-- ============================================
-- RLS: ENABLED with service_role bypass
-- Auth enforced in Next.js API routes via Clerk.
-- Service role key bypasses RLS natively, but
-- policies are explicit for security compliance.
-- ============================================
-- Enable RLS on all tables.
-- No extra policies needed — all access uses SUPABASE_SERVICE_ROLE_KEY
-- server-side (Next.js API routes), which has bypassrls by design.
alter table public.users                enable row level security;
alter table public.user_preferences     enable row level security;
alter table public.user_agents          enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.wallets              enable row level security;
alter table public.transactions         enable row level security;
alter table public.posts                enable row level security;
alter table public.post_likes           enable row level security;
alter table public.post_comments        enable row level security;
alter table public.user_media           enable row level security;
-- ============================================
-- Indexes for performance
-- ============================================
create index if not exists idx_users_clerk_id on public.users(clerk_id);
create index if not exists idx_users_email on public.users(email);
create index if not exists idx_user_agents_user_id on public.user_agents(user_id);
create index if not exists idx_user_preferences_user_id on public.user_preferences(user_id);
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_wallets_user_id on public.wallets(user_id);
create index if not exists idx_transactions_user_id on public.transactions(user_id);
create unique index if not exists uniq_transactions_stripe_session
  on public.transactions ((metadata->>'stripe_session_id'))
  where type = 'purchase' and metadata->>'stripe_session_id' is not null;
create index if not exists idx_posts_user_id on public.posts(user_id);
create index if not exists idx_posts_created_at on public.posts(created_at desc);
create index if not exists idx_post_likes_post_id on public.post_likes(post_id);
create index if not exists idx_post_comments_post_id on public.post_comments(post_id);
create index if not exists idx_user_media_user_id on public.user_media(user_id);
create index if not exists idx_user_media_is_public on public.user_media(is_public, created_at desc);
create index if not exists idx_user_media_category on public.user_media(category) where is_public = true;
-- ============================================
-- RPC Functions (called from API routes)
-- ============================================
-- Increment post likes
create or replace function public.increment_post_likes(post_id uuid)
returns void as $$
begin
  update public.posts set likes_count = likes_count + 1, updated_at = now()
  where id = post_id;
end;
$$ language plpgsql;
-- Decrement post likes
create or replace function public.decrement_post_likes(post_id uuid)
returns void as $$
begin
  update public.posts set likes_count = greatest(0, likes_count - 1), updated_at = now()
  where id = post_id;
end;
$$ language plpgsql;
-- Increment post comments
create or replace function public.increment_post_comments(post_id uuid)
returns void as $$
begin
  update public.posts set comments_count = comments_count + 1, updated_at = now()
  where id = post_id;
end;
$$ language plpgsql;
-- Idempotent, atomic Stripe coin-pack crediting (see migration
-- 20260708210000_credit_coin_pack_idempotent.sql). Safe to call repeatedly for
-- the same p_stripe_session_id.
create or replace function public.credit_coin_pack(
  p_user_id uuid,
  p_coin_amount integer,
  p_stripe_session_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_balance integer;
begin
  select w.balance into v_new_balance
  from public.wallets w
  where w.user_id = p_user_id;

  if exists (
    select 1
    from public.transactions t
    where t.type = 'purchase'
      and t.metadata->>'stripe_session_id' = p_stripe_session_id
  ) then
    return coalesce(v_new_balance, 0);
  end if;

  insert into public.wallets (user_id, balance, updated_at)
  values (p_user_id, 500 + p_coin_amount, now())
  on conflict (user_id)
  do update set balance = public.wallets.balance + p_coin_amount,
                updated_at = now()
  returning balance into v_new_balance;

  insert into public.transactions (user_id, type, amount, balance_after, description, metadata)
  values (
    p_user_id,
    'purchase',
    p_coin_amount,
    v_new_balance,
    'Purchased ' || p_coin_amount || ' LiTBit Coins via Stripe',
    jsonb_build_object('stripe_session_id', p_stripe_session_id)
  );

  return v_new_balance;
end;
$$;
grant execute on function public.credit_coin_pack(uuid, integer, text) to service_role;
-- ============================================
-- Deployments table (for LiTBiT deploy pipeline tracking)
-- ============================================
create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  task_id text,
  branch text not null,
  commit_sha text,
  environment text not null check (environment in ('preview', 'staging', 'production')),
  status text not null check (status in ('queued', 'building', 'deploying', 'live', 'failed', 'cancelled')),
  pipeline_url text,
  deploy_url text,
  source text not null check (source in ('gitlab', 'manual', 'deploy-agent', 'vercel')),
  metadata jsonb default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists idx_deployments_created_at on public.deployments(created_at desc);
create index if not exists idx_deployments_status on public.deployments(status);
create index if not exists idx_deployments_environment on public.deployments(environment);
alter table public.deployments enable row level security;
-- ============================================
-- Extended platform tables (self-contained — no separate migration needed)
-- ============================================
-- Rate limiter (serverless-compatible)
CREATE TABLE IF NOT EXISTS public.rate_limit_store (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window_start ON public.rate_limit_store(window_start);
ALTER TABLE public.rate_limit_store ENABLE ROW LEVEL SECURITY;
-- Agents catalog (matches /api/agents and /api/agents/status)
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  role TEXT NOT NULL DEFAULT 'general',
  system_prompt TEXT,
  personality TEXT,
  model TEXT DEFAULT 'gpt-4o-mini',
  is_core BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT true,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_slug ON public.agents(slug);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON public.agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_core ON public.agents(is_core);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
-- Active tasks (matches /api/agents/status)
CREATE TABLE IF NOT EXISTS public.active_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  task_type TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  input TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_active_tasks_agent ON public.active_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_active_tasks_status ON public.active_tasks(status);
ALTER TABLE public.active_tasks ENABLE ROW LEVEL SECURITY;
-- Agent chat conversations (matches /api/conversations)
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON public.conversations(agent_id);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON public.conversation_messages(conversation_id);
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
-- Creator earnings (matches /creator hub)
CREATE TABLE IF NOT EXISTS public.creator_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
  sales_count INTEGER DEFAULT 0,
  total_earnings_lbc INTEGER DEFAULT 0,
  total_earnings_usd_cents INTEGER DEFAULT 0,
  platform_fees_lbc INTEGER DEFAULT 0,
  withdrawn_lbc INTEGER DEFAULT 0,
  available_lbc INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);
ALTER TABLE public.creator_earnings ENABLE ROW LEVEL SECURITY;
-- Seed core agents (idempotent)
INSERT INTO public.agents (slug, display_name, description, role, is_core, is_public)
VALUES
  ('director', 'Director', 'Orchestrates multi-agent workflows and platform strategy', 'Orchestrator', true, true),
  ('champion', 'Champion', 'General assistant for user queries and tasks', 'General Assistant', true, true),
  ('code-champion', 'Code Champion', 'Software engineering and code review', 'Software Engineer', true, true),
  ('social-dominator', 'Social Dominator', 'Growth, content, and social scheduling', 'Growth & Content', true, true),
  ('data-slayer', 'Data Slayer', 'Data science and telemetry analysis', 'Data Scientist', true, true),
  ('writing-coach', 'Writing Coach', 'Content writing and editing', 'Content Writer', true, true),
  ('music-producer', 'Music Producer', 'Audio and music generation', 'Music Generation', true, true)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  is_core = EXCLUDED.is_core,
  is_public = EXCLUDED.is_public,
  updated_at = now();
-- ============================================
-- Runs & execution telemetry for LiT Console v2
-- ============================================
-- Unified run represents one user-driven execution flow across chat/terminal/agents.
-- run_steps capture ordered execution events; run_artifacts store produced outputs/proof.
CREATE TABLE IF NOT EXISTS public.runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','needs_approval','running','paused','completed','failed','cancelled')),
  source TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat','terminal','api','workflow','agent')),
  intent TEXT NOT NULL,
  plan JSONB DEFAULT '{}'::jsonb,
  risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_runs_owner_id ON public.runs(owner_id);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON public.runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON public.runs(status);
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'step' CHECK (type IN ('step','terminal_output','diff','review','error','approval','artifact','tool','system')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error','skipped','awaiting_approval')),
  command TEXT,
  risk_level TEXT CHECK (risk_level IN ('low','medium','high','critical')),
  input JSONB DEFAULT '{}'::jsonb,
  output JSONB DEFAULT '{}'::jsonb,
  exit_code INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON public.run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_run_steps_status ON public.run_steps(status);
ALTER TABLE public.run_steps ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.run_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.run_steps(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('diff','screenshot','log','file','preview','error','report')),
  path TEXT NOT NULL,
  mime TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_run_id ON public.run_artifacts(run_id);
ALTER TABLE public.run_artifacts ENABLE ROW LEVEL SECURITY;
-- ============================================
-- Setup Instructions:
-- 1. Go to Supabase Dashboard → SQL Editor → "New Query"
-- 2. Paste this entire file
-- 3. Click "Run"
-- 4. Done — no RLS needed (auth handled in Next.js API routes)
-- ============================================
