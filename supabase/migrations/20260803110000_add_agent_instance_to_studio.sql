-- Add agent_instance_id to studio conversations and messages.
--
-- This bridges the marketplace agent instance (user_agents.id) to the
-- canonical Studio conversation runtime. When a user opens a marketplace
-- agent in Studio, the conversation and all messages are tagged with the
-- private instance ID.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.studio_conversations
  ADD COLUMN IF NOT EXISTS agent_instance_id UUID REFERENCES public.user_agents(id) ON DELETE SET NULL;

ALTER TABLE public.studio_conversation_messages
  ADD COLUMN IF NOT EXISTS agent_instance_id UUID REFERENCES public.user_agents(id) ON DELETE SET NULL;

-- Index for querying messages by agent instance.
CREATE INDEX IF NOT EXISTS idx_studio_messages_agent_instance
  ON public.studio_conversation_messages(agent_instance_id)
  WHERE agent_instance_id IS NOT NULL;

-- Index for querying conversations by agent instance.
CREATE INDEX IF NOT EXISTS idx_studio_conversations_agent_instance
  ON public.studio_conversations(agent_instance_id)
  WHERE agent_instance_id IS NOT NULL;

-- Add agent_instance_id and memory_namespace to memories table.
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS agent_instance_id UUID REFERENCES public.user_agents(id) ON DELETE SET NULL;

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS memory_namespace TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_memory_namespace
  ON public.memories(memory_namespace)
  WHERE memory_namespace IS NOT NULL;
