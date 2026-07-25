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

-- Update core agents with marketplace metadata (no fake ratings or installs)
UPDATE public.agents
SET
  features = ARRAY['Multi-agent orchestration', 'Strategy planning', 'Workflow automation'],
  price_cents = 0,
  rating = 0,
  installs = 0,
  is_featured = true
WHERE slug = 'director';

UPDATE public.agents
SET
  features = ARRAY['General assistance', 'Task handling', 'FAQ documentation'],
  price_cents = 0,
  rating = 0,
  installs = 0,
  is_featured = false
WHERE slug = 'champion';
