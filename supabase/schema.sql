-- ============================================
-- LiTreeLabStudios Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Users table (synced with Clerk)
-- Stores additional user data beyond Clerk's basic info
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
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

-- Row Level Security (RLS) Policies
-- Enable RLS on all tables
alter table public.users enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_agents enable row level security;
alter table public.subscriptions enable row level security;
alter table public.wallets enable row level security;

-- Users can read/update their own data
-- Users table: anyone can read basic profile, only owner can update
create policy "Users can read all profiles" on public.users
  for select using (true);

create policy "Users can update own profile" on public.users
  for update using (auth.uid() = id);

create policy "Users can insert own profile" on public.users
  for insert with check (auth.uid() = id);

-- User Preferences: only owner can read/update
create policy "Users can read own preferences" on public.user_preferences
  for select using (auth.uid() = user_id);

create policy "Users can update own preferences" on public.user_preferences
  for update using (auth.uid() = user_id);

create policy "Users can insert own preferences" on public.user_preferences
  for insert with check (auth.uid() = user_id);

-- User Agents: only owner can read/update
create policy "Users can read own agents" on public.user_agents
  for select using (auth.uid() = user_id);

create policy "Users can manage own agents" on public.user_agents
  for all using (auth.uid() = user_id);

-- Subscriptions: only owner can read
create policy "Users can read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Wallets: only owner can read/update
create policy "Users can read own wallet" on public.wallets
  for select using (auth.uid() = user_id);

create policy "Users can update own wallet" on public.wallets
  for update using (auth.uid() = user_id);

create policy "Users can insert own wallet" on public.wallets
  for insert with check (auth.uid() = user_id);

-- Function to auto-create user record on signup
-- This runs when a new user signs up via Clerk
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create user record
  INSERT INTO public.users (id, clerk_id, email, name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'clerk_id',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  -- Create default preferences
  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Create wallet with starting balance
  INSERT INTO public.wallets (user_id, balance)
  VALUES (NEW.id, 500)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to run on new user creation
-- Note: This requires the auth.users table to be accessible
-- Alternative: Handle user creation via API instead

-- Indexes for performance
create index if not exists idx_users_clerk_id on public.users(clerk_id);
create index if not exists idx_users_email on public.users(email);
create index if not exists idx_user_agents_user_id on public.user_agents(user_id);
create index if not exists idx_user_preferences_user_id on public.user_preferences(user_id);
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_wallets_user_id on public.wallets(user_id);

-- ============================================
-- Setup Instructions:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Paste this entire file
-- 3. Click "Run"
-- 4. Enable Row Level Security is automatic
-- 5. Set up Clerk webhook to sync users (optional)
-- ============================================
