-- Seed Nova, Forge, and Echo as agent templates + immutable published versions.
--
-- These are the three premium individually-purchasable specialist agents:
--   - Nova:  Creative director (brand, visual identity, design systems)
--   - Forge: DevOps & infrastructure engineer (CI/CD, deployments, monitoring)
--   - Echo:  Community & social media manager (engagement, content calendar, analytics)
--
-- Unlike the 5 subscription-bundled specialists, these are sold individually
-- via Stripe checkout. They have stripe_price_id placeholders that should
-- be replaced with real Stripe price IDs before going live.
--
-- Idempotent: ON CONFLICT DO UPDATE / DO NOTHING.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Insert the 3 premium agents
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.agents (slug, display_name, description, role, system_prompt, personality, model, is_core, is_public, is_featured, price_cents, features)
VALUES
  (
    'nova',
    'Nova',
    'Your creative director — brand identity, visual systems, and design language that makes products unforgettable.',
    'Creative Direction',
    'You are Nova — the creative director specialist inside LiTTree Lab Studios. You help teams build brands that feel inevitable, not arbitrary. You think in systems: color, type, spacing, motion, voice. You push for clarity and distinctiveness, not trends.',
    'Bold, precise, allergic to derivative work, and always thinking about the whole system',
    'gpt-4o-mini',
    false,
    true,
    true,
    2900,
    ARRAY['Brand identity', 'Visual systems', 'Design language', 'Color & type', 'Creative direction']
  ),
  (
    'forge',
    'Forge',
    'Your DevOps engineer — CI/CD pipelines, infrastructure as code, deployment automation, and production monitoring.',
    'DevOps & Infrastructure',
    'You are Forge — the DevOps and infrastructure specialist inside LiTTree Lab Studios. You make deployments boring (in the best way). You think in pipelines, leases, retries, and rollbacks. You automate everything that can be automated and document everything that cannot.',
    'Methodical, safety-first, allergic to manual deploys, and obsessed with observability',
    'gpt-4o-mini',
    false,
    true,
    true,
    2900,
    ARRAY['CI/CD pipelines', 'Infrastructure as code', 'Deployment automation', 'Monitoring', 'Production readiness']
  ),
  (
    'echo',
    'Echo',
    'Your community manager — engagement strategy, content calendars, social analytics, and brand voice across channels.',
    'Community & Social',
    'You are Echo — the community and social media specialist inside LiTTree Lab Studios. You help teams build real relationships with their audience, not just follower counts. You think in calendars, engagement loops, and authentic voice.',
    'Warm, authentic, data-informed, and allergic to engagement bait',
    'gpt-4o-mini',
    false,
    true,
    true,
    2900,
    ARRAY['Engagement strategy', 'Content calendars', 'Social analytics', 'Brand voice', 'Community management']
  )
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  system_prompt = EXCLUDED.system_prompt,
  personality = EXCLUDED.personality,
  is_public = true,
  is_featured = EXCLUDED.is_featured,
  price_cents = EXCLUDED.price_cents,
  features = EXCLUDED.features,
  updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Publish version 1.0.0 for each premium agent
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.agent_versions (agent_id, version, system_prompt, personality, model, features, price_cents, currency, status, published_at)
SELECT
  a.id,
  '1.0.0',
  a.system_prompt,
  a.personality,
  a.model,
  a.features,
  2900,
  'usd',
  'published',
  now()
FROM public.agents a
WHERE a.slug IN ('nova', 'forge', 'echo')
  AND NOT EXISTS (
    SELECT 1 FROM public.agent_versions av
    WHERE av.agent_id = a.id AND av.version = '1.0.0'
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Create marketplace_items listings
-- ═══════════════════════════════════════════════════════════════════════
--
-- Nova, Forge, Echo are individually purchasable (not subscription-bundled).
-- included_plan_ids is empty — access is granted via the purchase path only.

INSERT INTO public.marketplace_items (slug, name, description, item_type, agent_id, price_cents, currency, category, featured, included_plan_ids)
SELECT
  a.slug,
  a.display_name,
  a.description,
  'agent',
  a.id,
  a.price_cents,
  'usd',
  CASE a.slug
    WHEN 'nova' THEN 'creative'
    WHEN 'forge' THEN 'developer'
    WHEN 'echo' THEN 'marketing'
  END,
  true,
  ARRAY[]::TEXT[]
FROM public.agents a
WHERE a.slug IN ('nova', 'forge', 'echo')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  item_type = 'agent',
  agent_id = EXCLUDED.agent_id,
  price_cents = EXCLUDED.price_cents,
  category = EXCLUDED.category,
  featured = true,
  included_plan_ids = ARRAY[]::TEXT[],
  updated_at = now();
