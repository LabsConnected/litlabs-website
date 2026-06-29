-- ============================================
-- LiTTree Lab Studios — Comprehensive Schema Fix
-- Fixes mismatches between production DB and app code
-- ============================================

-- 1. Fix users table: add display_name (app expects it)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name TEXT;
UPDATE public.users SET display_name = COALESCE(name, username, 'User') WHERE display_name IS NULL;

-- 2. Drop and recreate agents table with correct schema (0 rows, safe to rebuild)
DROP TABLE IF EXISTS public.agents CASCADE;
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  role TEXT DEFAULT 'general',
  system_prompt TEXT,
  model TEXT,
  is_core BOOLEAN DEFAULT false,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_slug ON public.agents(slug);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON public.agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_core ON public.agents(is_core);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY agents_select_public ON public.agents FOR SELECT USING (true);
CREATE POLICY agents_insert_own ON public.agents FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY agents_update_own ON public.agents FOR UPDATE USING (owner_id = auth.uid() OR is_core = false);

-- 3. Drop and recreate notifications table with correct schema (0 rows, safe)
DROP TABLE IF EXISTS public.notifications CASCADE;
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  entity_type TEXT DEFAULT 'post',
  entity_id TEXT,
  content TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(recipient_id, read_at) WHERE read_at IS NULL;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT USING (recipient_id = auth.uid());
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE USING (recipient_id = auth.uid());

-- 4. Ensure comments table RLS policies exist (table already exists with correct schema)
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_select_public ON public.comments;
DROP POLICY IF EXISTS comments_insert_own ON public.comments;
DROP POLICY IF EXISTS comments_delete_own ON public.comments;
CREATE POLICY comments_select_public ON public.comments FOR SELECT USING (true);
CREATE POLICY comments_insert_own ON public.comments FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY comments_delete_own ON public.comments FOR DELETE USING (user_id = auth.uid());

-- 5. Create conversations table (app passes Clerk IDs as user_id)
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON public.conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(status);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_select_own ON public.conversations FOR SELECT USING (user_id = auth.uid()::text);
CREATE POLICY conversations_insert_own ON public.conversations FOR INSERT WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY conversations_update_own ON public.conversations FOR UPDATE USING (user_id = auth.uid()::text);
CREATE POLICY conversations_delete_own ON public.conversations FOR DELETE USING (user_id = auth.uid()::text);

-- 6. Drop and recreate messages table with correct schema
DROP TABLE IF EXISTS public.messages CASCADE;
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_select_own ON public.messages FOR SELECT USING (
  conversation_id IN (SELECT id FROM public.conversations WHERE user_id = auth.uid()::text)
);
CREATE POLICY messages_insert_own ON public.messages FOR INSERT WITH CHECK (
  conversation_id IN (SELECT id FROM public.conversations WHERE user_id = auth.uid()::text)
);

-- 7. Create agent_logs table
CREATE TABLE IF NOT EXISTS public.agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  level TEXT DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error', 'success')),
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON public.agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON public.agent_logs(created_at DESC);
ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_logs_select_all ON public.agent_logs FOR SELECT USING (true);

-- 8. Create active_tasks table
CREATE TABLE IF NOT EXISTS public.active_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input JSONB DEFAULT '{}',
  output JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_active_tasks_status ON public.active_tasks(status);
CREATE INDEX IF NOT EXISTS idx_active_tasks_agent ON public.active_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_active_tasks_created ON public.active_tasks(created_at DESC);
ALTER TABLE public.active_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY active_tasks_select_all ON public.active_tasks FOR SELECT USING (true);

-- 9. Create tracks table
CREATE TABLE IF NOT EXISTS public.tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'Unknown',
  album TEXT,
  duration_seconds INTEGER,
  storage_provider TEXT NOT NULL DEFAULT 'r2',
  storage_bucket TEXT,
  storage_key TEXT,
  public_url TEXT,
  cover_art_url TEXT,
  genre TEXT DEFAULT 'synthwave',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracks_active_order ON public.tracks(is_active, sort_order);
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tracks_select_active ON public.tracks FOR SELECT USING (true);

-- Insert default tracks
INSERT INTO public.tracks (title, artist, storage_provider, public_url, sort_order, genre) VALUES
  ('Neon Horizon', 'Synthwave Radio', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', 1, 'synthwave'),
  ('Night Drive', 'Kavinsky Style', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', 2, 'synthwave'),
  ('Cyber City', 'Darksynth', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', 3, 'darksynth'),
  ('Retrowave', 'Outrun FM', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', 4, 'retrowave'),
  ('Midnight Run', 'Synthwave OG', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', 5, 'synthwave'),
  ('Neon Dreams', 'Future Funk', 'url', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3', 6, 'futuresynth')
ON CONFLICT DO NOTHING;

-- 11. Create deployments table for LiTBiT deploy tracking
CREATE TABLE IF NOT EXISTS public.deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT,
  branch TEXT NOT NULL,
  commit_sha TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'staging', 'production')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'building', 'deploying', 'live', 'failed', 'cancelled')),
  pipeline_url TEXT,
  deploy_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('gitlab', 'manual', 'deploy-agent', 'vercel')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON public.deployments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON public.deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_environment ON public.deployments(environment);

ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

-- 12. Update schema_migrations to mark all applied
INSERT INTO supabase_migrations.schema_migrations (version) VALUES
  ('20240614'),
  ('20240615'),
  ('20240616'),
  ('20250617'),
  ('20250618'),
  ('20260116')
ON CONFLICT (version) DO NOTHING;
