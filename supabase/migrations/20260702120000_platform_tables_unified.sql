-- ============================================
-- Platform tables (canonical — matches app code)
-- Run after schema.sql in Supabase SQL Editor
-- Safe to re-run (IF NOT EXISTS / idempotent seeds)
-- ============================================

-- Rate limiter (serverless-compatible)
CREATE TABLE IF NOT EXISTS public.rate_limit_store (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window_start ON public.rate_limit_store(window_start);
ALTER TABLE public.rate_limit_store ENABLE ROW LEVEL SECURITY;

-- Agent orchestration jobs (matches /api/orchestrate)
CREATE TABLE IF NOT EXISTS public.orchestration_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent1_id TEXT NOT NULL,
  agent2_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed')),
  message_count INTEGER DEFAULT 0,
  max_messages INTEGER DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_user_id ON public.orchestration_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_status ON public.orchestration_jobs(status);
ALTER TABLE public.orchestration_jobs ENABLE ROW LEVEL SECURITY;

-- Agents catalog (matches /api/agents and /api/agents/status)
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  role TEXT NOT NULL DEFAULT 'general',
  system_prompt TEXT,
  personality TEXT,
  model TEXT DEFAULT 'gpt-4o-mini',
  is_core BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT true,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add columns if agents table already existed with different schema
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'general';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS system_prompt TEXT;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS personality TEXT;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS model TEXT DEFAULT 'gpt-4o-mini';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_core BOOLEAN DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agents_slug ON public.agents(slug);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON public.agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_core ON public.agents(is_core);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- Active tasks (matches /api/agents/status)
CREATE TABLE IF NOT EXISTS public.active_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  task_type TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  input TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_active_tasks_agent ON public.active_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_active_tasks_status ON public.active_tasks(status);
ALTER TABLE public.active_tasks ENABLE ROW LEVEL SECURITY;

-- Agent chat conversations (matches /api/conversations)
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON public.conversations(agent_id);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON public.conversation_messages(conversation_id);
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

-- Creator earnings (matches /creator hub)
CREATE TABLE IF NOT EXISTS public.creator_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
  sales_count INTEGER DEFAULT 0,
  total_earnings_lbc INTEGER DEFAULT 0,
  total_earnings_usd_cents INTEGER DEFAULT 0,
  platform_fees_lbc INTEGER DEFAULT 0,
  withdrawn_lbc INTEGER DEFAULT 0,
  available_lbc INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);
ALTER TABLE public.creator_earnings ENABLE ROW LEVEL SECURITY;

-- Seed core agents (idempotent)
INSERT INTO public.agents (slug, display_name, description, role, is_core, is_public)
VALUES
  ('director', 'Director', 'Orchestrates multi-agent workflows and platform strategy', 'Orchestrator', true, true),
  ('champion', 'Champion', 'General assistant for user queries and tasks', 'General Assistant', true, true),
  ('code-champion', 'Code Champion', 'Software engineering and code review', 'Software Engineer', true, true),
  ('social-dominator', 'Social Dominator', 'Growth, content, and social scheduling', 'Growth & Content', true, true),
  ('data-slayer', 'Data Slayer', 'Data science and telemetry analysis', 'Data Scientist', true, true),
  ('writing-coach', 'Writing Coach', 'Content writing and editing', 'Content Writer', true, true),
  ('music-producer', 'Music Producer', 'Audio and music generation', 'Music Generation', true, true)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  role = EXCLUDED.role,
  is_core = EXCLUDED.is_core,
  is_public = EXCLUDED.is_public,
  updated_at = now();
