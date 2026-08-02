-- ============================================
-- Seed the LiTT Launch Agent V1 in the database.
-- This creates the agent catalog entry, marketplace listing,
-- and a published agent version with pricing.
--
-- The Stripe Price ID must be set separately (via admin script
-- or environment variable) because it's environment-specific.
-- ============================================

BEGIN;

-- ─── Insert the Launch Agent ────────────────────────────────────
-- Use INSERT ... ON CONFLICT DO NOTHING so this is idempotent.

INSERT INTO public.agents (id, slug, name, description, category, is_public, is_featured, system_prompt, personality)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'litt-launch-agent',
  'LiTT Launch Agent',
  'A customer pays, gives it a project idea or repository, and it creates a plan, builds the site, shows a preview, requests approval, deploys it, and returns the real live URL.',
  'development',
  true,
  true,
  'You are the LiTT Launch Agent. You help customers build and deploy websites. You create plans, write code, run builds, start previews, and deploy — always with explicit human approval before mutations and deployment. You never expose secrets, run arbitrary terminal commands, or deploy without approval.',
  'Professional, efficient, and transparent. You explain what you are doing and why. You ask for approval before making changes.'
)
ON CONFLICT (id) DO NOTHING;

-- ─── Insert marketplace listing ─────────────────────────────────

INSERT INTO public.marketplace_items (
  id, slug, name, item_type, category, status,
  is_featured, is_official, is_beta,
  agent_id, billing_model
)
VALUES (
  '00000000-0000-4000-8000-000000000002'::uuid,
  'litt-launch-agent',
  'LiTT Launch Agent',
  'agent',
  'development',
  'beta',
  true,
  true,
  true,
  '00000000-0000-4000-8000-000000000001'::uuid,
  'one_time'
)
ON CONFLICT (id) DO NOTHING;

-- ─── Insert published agent version ─────────────────────────────
-- Price: $19.00 (1900 cents) one-time purchase
-- Stripe Price ID must be set via admin script after creating
-- the price in the Stripe Dashboard.

INSERT INTO public.agent_versions (
  id, agent_id, version, system_prompt, personality, model,
  features, price_cents, currency, status, stripe_price_id
)
VALUES (
  '00000000-0000-4000-8000-000000000003'::uuid,
  '00000000-0000-4000-8000-000000000001'::uuid,
  '1.0.0',
  'You are the LiTT Launch Agent. You help customers build and deploy websites. You create plans, write code, run builds, start previews, and deploy — always with explicit human approval before mutations and deployment. You never expose secrets, run arbitrary terminal commands, or deploy without approval.',
  'Professional, efficient, and transparent.',
  'anthropic/claude-3.5-sonnet',
  ARRAY['plan', 'build', 'preview', 'deploy', 'checkpoint', 'rollback'],
  1900,
  'usd',
  'published',
  NULL  -- Stripe Price ID set via admin script
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
