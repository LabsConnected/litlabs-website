-- ============================================
-- LiTreeLabStudios Database Schema
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
-- Setup Instructions:
-- 1. Go to Supabase Dashboard → SQL Editor → "New Query"
-- 2. Paste this entire file
-- 3. Click "Run"
-- 4. Done — no RLS needed (auth handled in Next.js API routes)
-- ============================================
