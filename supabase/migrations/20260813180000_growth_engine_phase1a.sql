-- ============================================
-- LiTT Growth Engine — Phase 1a
--
-- All providers in MANUAL mode (no paid API calls).
-- LiTT generates platform-native content, the user approves,
-- LiTT prepares ready-to-post output (compose URLs + clipboard),
-- the user posts by hand, LiTT records what was published.
--
-- Schema is forward-compatible with API mode (1b+):
--   growth_accounts has nullable Vault ref columns
--   growth_publications has the full status machine (publishing/unknown/etc)
--   No Vault secrets written, no pg_cron schedule, no RPC in 1a.
--
-- RLS: service_role bypasses (server-side API routes enforce Clerk auth).
-- user_id stores Clerk user ID (TEXT), matching browser_jobs / user_connections.
-- ============================================

-- ============================================
-- 1. growth_accounts — one row per (user, provider)
-- ============================================
CREATE TABLE IF NOT EXISTS public.growth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('x', 'reddit', 'hackernews', 'producthunt')),
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'api')),
  provider_account_id TEXT,
  provider_account_name TEXT,
  -- Vault references — nullable, unused in manual mode (1a).
  -- Populated when a provider flips to api mode (1b+).
  access_token_secret_id UUID,
  refresh_token_secret_id UUID,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked', 'disconnected', 'needs_reauth')),
  last_verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_growth_accounts_user_id ON public.growth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_growth_accounts_provider ON public.growth_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_growth_accounts_status ON public.growth_accounts(status);

-- ============================================
-- 2. growth_campaigns — a campaign = one event/announcement
--    adapted per platform.
-- ============================================
CREATE TABLE IF NOT EXISTS public.growth_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT,
  event_summary TEXT NOT NULL,
  target_providers TEXT[] NOT NULL DEFAULT ARRAY['x']::text[],
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'active', 'completed', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_campaigns_user_id ON public.growth_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_growth_campaigns_status ON public.growth_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_growth_campaigns_created_at ON public.growth_campaigns(created_at DESC);

-- ============================================
-- 3. growth_content — platform-native drafts per campaign
-- ============================================
CREATE TABLE IF NOT EXISTS public.growth_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.growth_campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text'
    CHECK (content_type IN ('text', 'thread', 'link', 'gallery')),
  media_urls TEXT[],
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected', 'published', 'archived')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_content_campaign_id ON public.growth_content(campaign_id);
CREATE INDEX IF NOT EXISTS idx_growth_content_user_id ON public.growth_content(user_id);
CREATE INDEX IF NOT EXISTS idx_growth_content_status ON public.growth_content(status);
CREATE INDEX IF NOT EXISTS idx_growth_content_provider ON public.growth_content(provider);

-- ============================================
-- 4. growth_publications — the publication record
--    Idempotent (unique idempotency_key), forward-compatible with API mode.
--    In manual mode (1a): draft → published (user reports the post URL).
--    In api mode (1b+): draft → publishing → published | retryable_failed | unknown.
-- ============================================
CREATE TABLE IF NOT EXISTS public.growth_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.growth_campaigns(id) ON DELETE SET NULL,
  content_id UUID REFERENCES public.growth_content(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT,
  idempotency_key TEXT NOT NULL,
  provider_request_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'scheduled', 'publishing', 'published',
                      'retryable_failed', 'permanent_failed', 'unknown', 'cancelled')),
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'api')),
  scheduled_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  publishing_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  external_id TEXT,
  external_url TEXT,
  last_http_status INTEGER,
  last_error TEXT,
  last_error_code TEXT,
  credits_charged NUMERIC(10, 4),
  utm_campaign TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique idempotency key prevents duplicate publication records
CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_publications_idempotency
  ON public.growth_publications(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_growth_publications_user_id ON public.growth_publications(user_id);
CREATE INDEX IF NOT EXISTS idx_growth_publications_campaign_id ON public.growth_publications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_growth_publications_content_id ON public.growth_publications(content_id);
CREATE INDEX IF NOT EXISTS idx_growth_publications_status ON public.growth_publications(status);
CREATE INDEX IF NOT EXISTS idx_growth_publications_provider ON public.growth_publications(provider);
CREATE INDEX IF NOT EXISTS idx_growth_publications_published_at ON public.growth_publications(published_at DESC);

-- ============================================
-- 5. growth_rules — per-user/per-provider policy
-- ============================================
CREATE TABLE IF NOT EXISTS public.growth_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  daily_post_limit INTEGER NOT NULL DEFAULT 3,
  min_interval_minutes INTEGER NOT NULL DEFAULT 60,
  cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  require_approval BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_growth_rules_user_id ON public.growth_rules(user_id);

-- ============================================
-- Row Level Security — service_role only
-- All access is server-side via supabaseAdmin (bypasses RLS).
-- No anon/authenticated policies: auth enforced in Next.js API routes via Clerk.
-- ============================================
ALTER TABLE public.growth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_rules ENABLE ROW LEVEL SECURITY;

-- service_role full access on all new tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'growth_accounts', 'growth_campaigns', 'growth_content',
    'growth_publications', 'growth_rules'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY service_role_all_%I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- ============================================
-- updated_at trigger
-- ============================================
CREATE OR REPLACE FUNCTION public.update_growth_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_growth_accounts_updated_at ON public.growth_accounts;
CREATE TRIGGER update_growth_accounts_updated_at
  BEFORE UPDATE ON public.growth_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_growth_updated_at();

DROP TRIGGER IF EXISTS update_growth_campaigns_updated_at ON public.growth_campaigns;
CREATE TRIGGER update_growth_campaigns_updated_at
  BEFORE UPDATE ON public.growth_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_growth_updated_at();

DROP TRIGGER IF EXISTS update_growth_content_updated_at ON public.growth_content;
CREATE TRIGGER update_growth_content_updated_at
  BEFORE UPDATE ON public.growth_content
  FOR EACH ROW EXECUTE FUNCTION public.update_growth_updated_at();

DROP TRIGGER IF EXISTS update_growth_publications_updated_at ON public.growth_publications;
CREATE TRIGGER update_growth_publications_updated_at
  BEFORE UPDATE ON public.growth_publications
  FOR EACH ROW EXECUTE FUNCTION public.update_growth_updated_at();

DROP TRIGGER IF EXISTS update_growth_rules_updated_at ON public.growth_rules;
CREATE TRIGGER update_growth_rules_updated_at
  BEFORE UPDATE ON public.growth_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_growth_updated_at();
