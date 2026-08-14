-- LiTT Agent Identity — add agent_mode to conversations and messages.
--
-- LiTT is the single primary operating agent. Spark, Builder, and Research
-- are MODES within LiTT, not separate autonomous agents.
--
-- This migration adds agent_mode columns to the conversation and message
-- tables, and migrates existing records to use the correct mode.

-- ─── studio_conversations: add active_agent_mode ──────────────────
ALTER TABLE public.studio_conversations
  ADD COLUMN IF NOT EXISTS active_agent_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (active_agent_mode IN ('standard', 'builder', 'research', 'spark'));

-- Migrate existing conversations: spark slug → spark mode, everything else → standard
UPDATE public.studio_conversations
SET active_agent_mode = 'spark'
WHERE active_agent_slug = 'spark' AND active_agent_mode = 'standard';

-- ─── studio_conversation_messages: add agent_mode ─────────────────
ALTER TABLE public.studio_conversation_messages
  ADD COLUMN IF NOT EXISTS agent_mode TEXT DEFAULT NULL
  CHECK (agent_mode IS NULL OR agent_mode IN ('standard', 'builder', 'research', 'spark'));

-- Migrate existing messages: spark slug → spark mode, everything else → standard
UPDATE public.studio_conversation_messages
SET agent_mode = 'spark'
WHERE agent_slug = 'spark' AND agent_mode IS NULL;

UPDATE public.studio_conversation_messages
SET agent_mode = 'standard'
WHERE agent_slug IS NOT NULL AND agent_slug != 'spark' AND agent_mode IS NULL;

-- ─── agent_runs: add agent_mode ───────────────────────────────────
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS agent_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (agent_mode IN ('standard', 'builder', 'research', 'spark'));

-- Migrate existing runs: spark slug → spark mode
-- (agent_slug may not exist on agent_runs in all deployment paths)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_runs' AND column_name = 'agent_slug'
  ) THEN
    UPDATE public.agent_runs
    SET agent_mode = 'spark'
    WHERE agent_slug = 'spark' AND agent_mode = 'standard';
  END IF;
END $$;

-- ─── agent_steps: add agent_mode ──────────────────────────────────
ALTER TABLE public.agent_steps
  ADD COLUMN IF NOT EXISTS agent_mode TEXT DEFAULT NULL
  CHECK (agent_mode IS NULL OR agent_mode IN ('standard', 'builder', 'research', 'spark'));

-- ─── memories: add agent_mode ─────────────────────────────────────
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS agent_mode TEXT DEFAULT NULL
  CHECK (agent_mode IS NULL OR agent_mode IN ('standard', 'builder', 'research', 'spark'));

-- Migrate existing memories: spark slug → spark mode
UPDATE public.memories
SET agent_mode = 'spark'
WHERE agent_slug = 'spark' AND agent_mode IS NULL;

-- ─── Index for memory isolation queries ───────────────────────────
-- Speeds up the conversation-scoped memory retrieval that prevents
-- cross-conversation context leakage (e.g. EDM artwork from a different chat).
CREATE INDEX IF NOT EXISTS idx_memories_conversation_id
  ON public.memories(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memories_agent_mode
  ON public.memories(agent_mode);
CREATE INDEX IF NOT EXISTS idx_memories_memory_type
  ON public.memories(memory_type);

-- ─── identity_source column for migration tracking ────────────────
-- Marks whether the agent identity was explicitly set by the client,
-- migrated from the slug, or defaulted during migration.
ALTER TABLE public.studio_conversation_messages
  ADD COLUMN IF NOT EXISTS identity_source TEXT NOT NULL DEFAULT 'client'
  CHECK (identity_source IN ('client', 'migration_default', 'migration_slug'));

-- Mark migrated messages
UPDATE public.studio_conversation_messages
SET identity_source = 'migration_slug'
WHERE agent_mode IS NOT NULL AND identity_source = 'client'
  AND created_at < now() - interval '1 minute';

-- Set identity_source to migration_default for messages with no agent_slug
UPDATE public.studio_conversation_messages
SET identity_source = 'migration_default',
    agent_mode = 'standard'
WHERE agent_slug IS NULL AND agent_mode IS NULL;
