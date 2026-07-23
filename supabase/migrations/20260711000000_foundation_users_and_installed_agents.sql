-- ============================================
-- Foundation: canonical users and installed agents
-- Run in Supabase SQL Editor before relying on Clerk auth routes.
-- Safe to re-run (IF NOT EXISTS / idempotent).
-- ============================================

-- Canonical users table. Clerk is the identity provider; this table owns
-- the local UUID that all other tables reference.
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  cover_url TEXT,
  bio TEXT,
  website TEXT,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON public.users(clerk_id);

-- Wallet for LiTT credits.
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,
  last_claim_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  theme_mode TEXT DEFAULT 'dark',
  theme_skin TEXT DEFAULT 'default',
  theme_accent TEXT DEFAULT 'cyan',
  crt_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);

-- Reconcile user_agents to also act as the install/dock table expected by
-- the app routes. The memory-specific columns already exist; we add the
-- join-table columns the API code needs.
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Unique constraint for install/dock semantics.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_agents_user_agent_unique'
  ) THEN
    ALTER TABLE public.user_agents
      ADD CONSTRAINT user_agents_user_agent_unique UNIQUE (user_id, agent_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_agents_user_id ON public.user_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_agents_agent_id ON public.user_agents(agent_id);

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER IF NOT EXISTS update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: deny direct client access; server routes use service_role with Clerk auth.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_deny_anon ON public.users;
CREATE POLICY users_deny_anon ON public.users FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS users_deny_authenticated ON public.users;
CREATE POLICY users_deny_authenticated ON public.users FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS wallets_deny_anon ON public.wallets;
CREATE POLICY wallets_deny_anon ON public.wallets FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS wallets_deny_authenticated ON public.wallets;
CREATE POLICY wallets_deny_authenticated ON public.wallets FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_preferences_deny_anon ON public.user_preferences;
CREATE POLICY user_preferences_deny_anon ON public.user_preferences FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS user_preferences_deny_authenticated ON public.user_preferences;
CREATE POLICY user_preferences_deny_authenticated ON public.user_preferences FOR ALL TO authenticated USING (false) WITH CHECK (false);
