-- ============================================
-- Initial schema: base tables required by all subsequent migrations.
--
-- This migration captures the original schema.sql that was applied to
-- Production via the Supabase SQL Editor before any migrations existed.
-- Without it, supabase db reset fails because early migrations assume
-- these tables already exist.
--
-- Modifications from the original schema.sql:
--   1. Added is_featured BOOLEAN DEFAULT false to agents table
--      (the seed INSERT and 20260702120000 both use this column,
--       which was originally added by 20260713180000 — but that runs
--       AFTER the seed INSERT, causing a fresh-db failure)
--   2. Added display_name, cover_url to users table
--      (originally added by 20260711000000 foundation migration via
--       CREATE TABLE IF NOT EXISTS, which is a no-op if the table
--       already exists from this migration)
--   3. Guarded cron.schedule in a DO block (pg_cron may not be
--      available in all environments)
--   4. Removed the setup instructions comment block
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
  display_name text,
  avatar_url text,
  cover_url text,
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
  notify_discord text,
  notify_alexa boolean default false,
  notify_email boolean default false,
  workspace_autosave boolean default true,
  workspace_compact boolean default false,
  workspace_live_preview boolean default true,
  workspace_telemetry boolean default false,
  workspace_default text default 'studio',
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
-- Guard: pg_cron may not be available in all environments
DO $cron_check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-rate-limits',
      '*/5 * * * *',
      $$delete from public.rate_limits where created_at < now() - interval '5 minutes'$$
    );
  END IF;
END $cron_check$;

-- ============================================
-- RLS: ENABLED with service_role bypass
-- Auth enforced in Next.js API routes via Clerk.
-- Service role key bypasses RLS natively, but
-- policies are explicit for security compliance.
-- ============================================

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

create or replace function public.increment_post_likes(post_id uuid)
returns void as $$
begin
  update public.posts set likes_count = likes_count + 1, updated_at = now()
  where id = post_id;
end;
$$ language plpgsql;

create or replace function public.decrement_post_likes(post_id uuid)
returns void as $$
begin
  update public.posts set likes_count = greatest(0, likes_count - 1), updated_at = now()
  where id = post_id;
end;
$$ language plpgsql;

create or replace function public.increment_post_comments(post_id uuid)
returns void as $$
begin
  update public.posts set comments_count = comments_count + 1, updated_at = now()
  where id = post_id;
end;
$$ language plpgsql;

-- ============================================
-- Deployments table
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
-- Extended platform tables
-- ============================================

CREATE TABLE IF NOT EXISTS public.rate_limit_store (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window_start ON public.rate_limit_store(window_start);
ALTER TABLE public.rate_limit_store ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.orchestration_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent1_id TEXT NOT NULL,
  agent2_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed')),
  message_count INTEGER DEFAULT 0,
  max_messages INTEGER DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_user_id ON public.orchestration_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_status ON public.orchestration_jobs(status);
ALTER TABLE public.orchestration_jobs ENABLE ROW LEVEL SECURITY;

-- Agents catalog — includes is_featured for seed INSERT compatibility
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
  is_featured BOOLEAN DEFAULT false,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_slug ON public.agents(slug);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON public.agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_core ON public.agents(is_core);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

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

-- Seed marketplace items (idempotent)
INSERT INTO public.agents (slug, display_name, description, role, is_core, is_public, is_featured)
VALUES
  ('director', 'Mission Orchestration', 'Multi-agent workflow orchestration, strategy planning, and task automation.', 'automation', true, true, true),
  ('champion', 'General Productivity', 'General assistance, task handling, and FAQ documentation.', 'automation', true, true, false),
  ('code-champion', 'Software Engineering', 'Code review, debugging, implementation, and test support.', 'development', true, true, true),
  ('social-dominator', 'Social Growth', 'Growth, content, and social scheduling for creators.', 'creative', true, true, true),
  ('data-slayer', 'Analytics', 'Data science, telemetry analysis, and reporting.', 'data', true, true, false),
  ('writing-coach', 'Writing and Editing', 'Content writing, editing, and proofreading.', 'creative', true, true, false),
  ('music-producer', 'Music Creation', 'Audio and music generation tools.', 'media', true, true, false)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  is_core = EXCLUDED.is_core,
  is_public = EXCLUDED.is_public,
  is_featured = EXCLUDED.is_featured,
  updated_at = now();
