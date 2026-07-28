-- ============================================
-- Command Studio V12: Canonical conversations, messages, and memory schema
--
-- Forward-only migration. Does not rewrite existing migrations.
-- Adds columns to existing tables and creates new tables where needed.
--
-- Key changes:
-- 1. studio_conversations — ownership-scoped, revision-controlled, project-linked
-- 2. studio_conversation_messages — full message contract with status, parent, idempotency
-- 3. memories table — add project_id, agent_slug, memory_type, dedupe_key, metadata
-- 4. RLS policies for user-scoped access
-- ============================================

-- ============================================
-- 1. Studio Conversations
-- ============================================
CREATE TABLE IF NOT EXISTS public.studio_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  project_id uuid NOT NULL,
  title text,
  active_agent_slug text NOT NULL DEFAULT 'litt'
    CHECK (active_agent_slug IN ('litt', 'spark')),
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_studio_conversations_owner
  ON public.studio_conversations(owner_id);
CREATE INDEX IF NOT EXISTS idx_studio_conversations_project
  ON public.studio_conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_studio_conversations_owner_project
  ON public.studio_conversations(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_studio_conversations_owner_updated
  ON public.studio_conversations(owner_id, updated_at DESC);

ALTER TABLE public.studio_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_conversations_owner_select ON public.studio_conversations;
CREATE POLICY studio_conversations_owner_select ON public.studio_conversations
  FOR SELECT TO authenticated USING (false);

DROP POLICY IF EXISTS studio_conversations_service_role ON public.studio_conversations;
CREATE POLICY studio_conversations_service_role ON public.studio_conversations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 2. Studio Conversation Messages
-- ============================================
CREATE TABLE IF NOT EXISTS public.studio_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES public.studio_conversations(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  project_id uuid NOT NULL,
  role text NOT NULL
    CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  agent_slug text
    CHECK (agent_slug IS NULL OR agent_slug IN ('litt', 'spark')),
  content text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled')),
  parent_message_id uuid
    REFERENCES public.studio_conversation_messages(id) ON DELETE SET NULL,
  regeneration_of_message_id uuid
    REFERENCES public.studio_conversation_messages(id) ON DELETE SET NULL,
  client_request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_messages_conversation_created
  ON public.studio_conversation_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_studio_messages_owner_project
  ON public.studio_conversation_messages(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_studio_messages_client_request
  ON public.studio_conversation_messages(client_request_id);
CREATE INDEX IF NOT EXISTS idx_studio_messages_regeneration
  ON public.studio_conversation_messages(regeneration_of_message_id);

-- Idempotency: one user message per client_request_id per conversation+owner
CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_messages_idempotent
  ON public.studio_conversation_messages(owner_id, conversation_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE public.studio_conversation_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_messages_service_role ON public.studio_conversation_messages;
CREATE POLICY studio_messages_service_role ON public.studio_conversation_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 3. Memory schema corrections
-- Add project_id, conversation_id, agent_slug, memory_type, dedupe_key, metadata
-- to the existing memories table.
-- ============================================
ALTER TABLE memories ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_slug text
  CHECK (agent_slug IS NULL OR agent_slug IN ('litt', 'spark'));
ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_type text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Indexes for project-scoped memory queries
CREATE INDEX IF NOT EXISTS idx_memories_owner_project
  ON memories(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_memories_owner_project_agent_type
  ON memories(owner_id, project_id, agent_slug, memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_project_agent
  ON memories(project_id, agent_slug);

-- Dedupe unique constraint: one memory per (owner, project, agent, type, dedupe_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_dedupe
  ON memories(owner_id, project_id, agent_slug, memory_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ============================================
-- 4. Updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION public.studio_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_studio_conversations_updated_at ON public.studio_conversations;
CREATE TRIGGER trigger_studio_conversations_updated_at
  BEFORE UPDATE ON public.studio_conversations
  FOR EACH ROW EXECUTE FUNCTION public.studio_conversations_updated_at();

CREATE OR REPLACE FUNCTION public.studio_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_studio_messages_updated_at ON public.studio_conversation_messages;
CREATE TRIGGER trigger_studio_messages_updated_at
  BEFORE UPDATE ON public.studio_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.studio_messages_updated_at();
