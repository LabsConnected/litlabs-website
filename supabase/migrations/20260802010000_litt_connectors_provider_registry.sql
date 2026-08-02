-- ============================================
-- LiTT Personal Intelligence Connectors
-- PR 1: Integration schema and provider registry
--
-- Expands the integration platform to support:
--   User connections: google, microsoft, slack, notion, dropbox
--   Platform integrations: open_meteo, brave_search, firecrawl, nango
--
-- Separates platform-owned integrations from user-authorized connections.
-- Adds capability registry, consent metadata, and health verification.
--
-- RLS: service_role bypasses (server-side API routes enforce Clerk auth).
-- user_id stores Clerk user ID.
-- ============================================

-- ============================================
-- 1. Expand integration_accounts provider constraint
-- ============================================
-- Drop the old constraint and replace with an expanded one
ALTER TABLE public.integration_accounts
  DROP CONSTRAINT IF EXISTS integration_accounts_provider_check;

ALTER TABLE public.integration_accounts
  ADD CONSTRAINT integration_accounts_provider_check
  CHECK (provider IN (
    'github', 'meta', 'vercel', 'supabase',
    'google', 'microsoft', 'slack', 'notion', 'dropbox',
    'open_meteo', 'brave_search', 'firecrawl', 'nango'
  ));

-- Add new columns for connection health and verification
ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS connection_reference text,
  ADD COLUMN IF NOT EXISTS requested_scopes text[],
  ADD COLUMN IF NOT EXISTS granted_scopes text[],
  ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- ============================================
-- 2. platform_integrations — LiTTree-owned API services
-- APIs paid for and configured by LiTTree, not per-user OAuth
-- ============================================
CREATE TABLE IF NOT EXISTS public.platform_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN (
    'open_meteo', 'brave_search', 'firecrawl', 'nango',
    'gemini', 'openai', 'anthropic', 'openrouter', 'groq',
    'r2', 'stripe', 'vercel', 'supabase'
  )),
  configured boolean NOT NULL DEFAULT false,
  healthy boolean NOT NULL DEFAULT false,
  last_verified_at timestamptz,
  endpoint_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider)
);

CREATE INDEX IF NOT EXISTS platform_integrations_provider_idx
  ON public.platform_integrations(provider);

-- ============================================
-- 3. user_connections — per-user authorized accounts
-- Separates from integration_accounts to distinguish
-- platform services from user OAuth connections
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN (
    'google', 'microsoft', 'github', 'meta',
    'slack', 'notion', 'dropbox'
  )),
  provider_account_id text,
  provider_account_name text,
  provider_account_email text,
  scopes text[] NOT NULL DEFAULT '{}',
  requested_scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'degraded', 'expired', 'missing_permission', 'disconnected')),
  connection_reference text,
  last_connected_at timestamptz,
  last_verified_at timestamptz,
  last_access_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS user_connections_user_id_idx
  ON public.user_connections(user_id);
CREATE INDEX IF NOT EXISTS user_connections_provider_idx
  ON public.user_connections(provider);
CREATE INDEX IF NOT EXISTS user_connections_status_idx
  ON public.user_connections(status);

-- ============================================
-- 4. user_connection_credentials — encrypted credentials
-- Never exposed to the browser. Stores refresh tokens etc.
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_connection_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_connection_id uuid NOT NULL
    REFERENCES public.user_connections(id) ON DELETE CASCADE,
  credential_type text NOT NULL,
  encrypted_value text NOT NULL,
  expires_at timestamptz,
  scopes text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_connection_credentials_connection_id_idx
  ON public.user_connection_credentials(user_connection_id);

-- ============================================
-- 5. connector_capabilities — capability registry
-- Tracks which capabilities are available per user/connection
-- ============================================
CREATE TABLE IF NOT EXISTS public.connector_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  capability_id text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'unavailable'
    CHECK (status IN ('ready', 'unavailable', 'unknown', 'needs_connection', 'needs_permission', 'disabled')),
  user_connection_id uuid
    REFERENCES public.user_connections(id) ON DELETE SET NULL,
  last_verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, capability_id)
);

CREATE INDEX IF NOT EXISTS connector_capabilities_user_id_idx
  ON public.connector_capabilities(user_id);
CREATE INDEX IF NOT EXISTS connector_capabilities_capability_id_idx
  ON public.connector_capabilities(capability_id);

-- ============================================
-- 6. connector_audit_log — action audit trail
-- Records every tool execution for accountability
-- ============================================
CREATE TABLE IF NOT EXISTS public.connector_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  capability_id text NOT NULL,
  provider text NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed', 'denied', 'pending_approval', 'approved', 'revoked')),
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_connection_id uuid
    REFERENCES public.user_connections(id) ON DELETE SET NULL,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connector_audit_log_user_id_idx
  ON public.connector_audit_log(user_id);
CREATE INDEX IF NOT EXISTS connector_audit_log_capability_id_idx
  ON public.connector_audit_log(capability_id);
CREATE INDEX IF NOT EXISTS connector_audit_log_created_at_idx
  ON public.connector_audit_log(created_at DESC);

-- ============================================
-- 7. user_preferences — per-user context and preferences
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  timezone text,
  locale text,
  temperature_unit text DEFAULT 'celsius'
    CHECK (temperature_unit IN ('celsius', 'fahrenheit')),
  distance_unit text DEFAULT 'metric'
    CHECK (distance_unit IN ('metric', 'imperial')),
  location_mode text DEFAULT 'none'
    CHECK (location_mode IN ('none', 'manual_city', 'device_location')),
  saved_city text,
  saved_region text,
  country_code text,
  news_interests text[] NOT NULL DEFAULT '{}',
  daily_briefing_enabled boolean NOT NULL DEFAULT false,
  daily_briefing_time text,
  default_calendar_provider text,
  default_email_provider text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_preferences_user_id_idx
  ON public.user_preferences(user_id);

-- ============================================
-- Row Level Security — service_role only
-- ============================================
ALTER TABLE public.platform_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_connection_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- service_role full access on all new tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'platform_integrations', 'user_connections', 'user_connection_credentials',
    'connector_capabilities', 'connector_audit_log', 'user_preferences'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY service_role_all_%I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- No anon/authenticated policies: all access is server-side via service_role.
