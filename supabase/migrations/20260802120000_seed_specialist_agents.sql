-- Seed the 5 specialist agents into the runtime + marketplace.
--
-- This migration creates the agents, their published agent_versions, and
-- their marketplace_items listings with the correct included_plan_ids so
-- the entitlement resolver grants access to the right subscription tiers.
--
-- Specialist agents are bundled into subscriptions (not sold individually
-- in V1), so billing_model = 'subscription' and price_cents = 0 on the
-- agent_versions row (the subscription price is the source of truth).
-- Individual purchase is still supported by the existing checkout flow if
-- a stripe_price_id is later attached to a version.
--
-- Idempotent: ON CONFLICT DO NOTHING / UPDATE so re-running is safe.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Insert the 5 specialist agents
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.agents (slug, display_name, description, role, system_prompt, personality, model, is_core, is_public, is_featured, price_cents, features)
VALUES
  (
    'researcher',
    'Researcher',
    'Turns hours of searching into usable findings — source-backed research, competitor comparisons, and claim verification.',
    'Research & Synthesis',
    'You are Researcher — the research and synthesis specialist inside LiTTree Lab Studios. Your job is to turn scattered questions into usable, source-backed findings.',
    'Methodical, skeptical, precise, and transparent about sources',
    'gpt-4o-mini',
    false,
    true,
    true,
    0,
    ARRAY['Research planning', 'Source gathering', 'Verification', 'Comparison', 'Source-backed synthesis']
  ),
  (
    'writer',
    'Writer',
    'Produces ready-to-publish content — landing pages, posts, emails, product copy, and edits.',
    'Content & Copy',
    'You are Writer — the content and copy specialist inside LiTTree Lab Studios. Your output must be ready to use, not a rough draft.',
    'Clear, persuasive, adaptable in tone, and allergic to filler',
    'gpt-4o-mini',
    false,
    true,
    true,
    0,
    ARRAY['Long-form content', 'Landing pages', 'Emails', 'Product copy', 'Editing and rewriting']
  ),
  (
    'marketer',
    'Marketer',
    'Helps businesses attract customers — positioning, audience definition, campaigns, SEO, and conversion recommendations.',
    'Marketing & Growth',
    'You are Marketer — the marketing and growth specialist inside LiTTree Lab Studios. You help businesses attract the right customers.',
    'Pragmatic, audience-obsessed, and honest about what''s a guess',
    'gpt-4o-mini',
    false,
    true,
    true,
    0,
    ARRAY['Positioning', 'Audience definition', 'Campaigns', 'SEO planning', 'Social content', 'Conversion recommendations']
  ),
  (
    'coder',
    'Coder',
    'Converts ideas into working software — repository-aware implementation, debugging, code review, testing, and architecture.',
    'Engineering & Implementation',
    'You are Coder — the engineering and implementation specialist inside LiTTree Lab Studios. You convert ideas into working, tested software.',
    'Rigorous, practical, and never claims work it hasn''t verified',
    'gpt-4o-mini',
    false,
    true,
    true,
    0,
    ARRAY['Repository-aware implementation', 'Debugging', 'Code review', 'Testing', 'Architecture']
  ),
  (
    'analyst',
    'Analyst',
    'Explains performance and finds the next move — data interpretation, KPI analysis, reports, and trend and anomaly detection.',
    'Data & Analytics',
    'You are Analyst — the data and analytics specialist inside LiTTree Lab Studios. You explain performance and find the next move.',
    'Evidence-first, precise about uncertainty, and clear about gaps',
    'gpt-4o-mini',
    false,
    true,
    true,
    0,
    ARRAY['Data interpretation', 'KPI analysis', 'Report generation', 'Trend and anomaly detection']
  )
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  system_prompt = EXCLUDED.system_prompt,
  personality = EXCLUDED.personality,
  is_public = true,
  is_featured = EXCLUDED.is_featured,
  price_cents = 0,
  features = EXCLUDED.features,
  updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Publish version 1.0.0 for each specialist agent
-- ═══════════════════════════════════════════════════════════════════════
--
-- agent_versions are immutable once published. We insert with status =
-- 'published' directly. The immutability trigger blocks future updates
-- to these rows. To change a prompt, create a new version (1.1.0, etc.).

INSERT INTO public.agent_versions (agent_id, version, system_prompt, personality, model, features, price_cents, currency, status, published_at)
SELECT
  a.id,
  '1.0.0',
  a.system_prompt,
  a.personality,
  a.model,
  a.features,
  0,
  'usd',
  'published',
  now()
FROM public.agents a
WHERE a.slug IN ('researcher', 'writer', 'marketer', 'coder', 'analyst')
  AND NOT EXISTS (
    SELECT 1 FROM public.agent_versions av
    WHERE av.agent_id = a.id AND av.version = '1.0.0'
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Create marketplace_items listings for each specialist agent
-- ═══════════════════════════════════════════════════════════════════════
--
-- included_plan_ids controls which subscription tiers unlock the agent via
-- the plan-based entitlement path. The marketplace authorization code reads
-- this column. Founder is NOT listed for Pro-only agents (Coder, Analyst)
-- because founder = Creator-level for agent access.
--
-- Researcher, Writer, Marketer: creator_beta + pro_builder_beta + founder
-- Coder, Analyst: pro_builder_beta only

INSERT INTO public.marketplace_items (
  slug, name, description, item_type, category, status,
  compatible_assistants, capability_key, version, icon,
  is_featured, is_official, is_beta,
  price_cents, agent_id, agent_version_id, billing_model,
  included_plan_ids, required_connections
)
SELECT
  a.slug,
  a.display_name,
  a.description,
  'agent',
  CASE a.slug
    WHEN 'researcher' THEN 'research'
    WHEN 'writer' THEN 'content'
    WHEN 'marketer' THEN 'marketing'
    WHEN 'coder' THEN 'development'
    WHEN 'analyst' THEN 'analytics'
  END,
  'available',
  ARRAY['litt'],
  'agent.' || a.slug,
  '1.0.0',
  CASE a.slug
    WHEN 'researcher' THEN '🔍'
    WHEN 'writer' THEN '✍️'
    WHEN 'marketer' THEN '📣'
    WHEN 'coder' THEN '💻'
    WHEN 'analyst' THEN '📊'
  END,
  true,
  true,
  true,
  0,
  a.id,
  av.id,
  'subscription',
  CASE a.slug
    WHEN 'researcher' THEN ARRAY['creator_beta', 'pro_builder_beta', 'founder']
    WHEN 'writer' THEN ARRAY['creator_beta', 'pro_builder_beta', 'founder']
    WHEN 'marketer' THEN ARRAY['creator_beta', 'pro_builder_beta', 'founder']
    WHEN 'coder' THEN ARRAY['pro_builder_beta']
    WHEN 'analyst' THEN ARRAY['pro_builder_beta']
  END,
  ARRAY[]::text[]
FROM public.agents a
JOIN public.agent_versions av ON av.agent_id = a.id AND av.version = '1.0.0'
WHERE a.slug IN ('researcher', 'writer', 'marketer', 'coder', 'analyst')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  item_type = 'agent',
  category = EXCLUDED.category,
  status = 'available',
  agent_id = EXCLUDED.agent_id,
  agent_version_id = EXCLUDED.agent_version_id,
  billing_model = 'subscription',
  included_plan_ids = EXCLUDED.included_plan_ids,
  is_featured = true,
  is_official = true,
  is_beta = true,
  price_cents = 0,
  updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Ensure LiTT and Spark exist as core agents (idempotent)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.agents (slug, display_name, description, role, system_prompt, personality, model, is_core, is_public, is_featured, price_cents, features)
VALUES
  (
    'litt',
    'LiTT',
    'Your lead AI copilot — builds, reviews, deploys, and orchestrates your whole project.',
    'AI Copilot, Engineer & Creator',
    'You are LiTT — the lead AI copilot inside LiTTree Lab Studios.',
    'Technically precise, strategically sharp, creative, direct, and loyal to the user',
    'gpt-4o-mini',
    true,
    true,
    true,
    0,
    ARRAY['Engineering', 'Strategy', 'Orchestration', 'DevOps']
  ),
  (
    'spark',
    'Spark',
    'Your playful creative companion — ideation, design direction, and creative exploration.',
    'Creative Companion & Explorer',
    'You are Spark — LiTT''s playful creative companion inside LiTTree Lab Studios.',
    'Playful, curious, energetic, imaginative, and encouraging',
    'gpt-4o-mini',
    true,
    true,
    false,
    0,
    ARRAY['Ideation', 'Design', 'Creative exploration']
  )
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  is_core = true,
  is_public = true,
  is_featured = EXCLUDED.is_featured,
  price_cents = 0,
  updated_at = now();
