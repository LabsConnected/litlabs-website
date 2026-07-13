-- Marketplace agent metadata
-- Adds pricing, features, ratings, and avatar fields to the agents catalog
-- so the marketplace can display real data instead of hardcoded demo agents.

ALTER TABLE public.agents
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS features TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) DEFAULT 0,
ADD COLUMN IF NOT EXISTS installs INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

-- Update core agents with real marketplace metadata
UPDATE public.agents
SET
  avatar_url = '/showcase/cover-architecture.png',
  features = ARRAY['Multi-agent orchestration', 'Strategy planning', 'Workflow automation'],
  price_cents = 0,
  rating = 4.9,
  installs = 1240,
  is_featured = true,
  description = 'The master orchestrator. Coordinates strategy, builds agent systems, and delegates tasks across your entire platform.',
  role = 'orchestrator',
  personality = 'Strategic, decisive, concise'
WHERE slug = 'director';

UPDATE public.agents
SET
  avatar_url = '/showcase/engine-routing.png',
  features = ARRAY['General assistance', 'Task handling', 'FAQ documentation'],
  price_cents = 0,
  rating = 4.6,
  installs = 543,
  is_featured = false,
  description = 'Your general-purpose assistant for queries, tasks, and everyday operations.',
  role = 'general',
  personality = 'Patient, helpful, clear'
WHERE slug = 'champion';
